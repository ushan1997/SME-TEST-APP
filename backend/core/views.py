import csv
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.db.models import Avg, Count, Max, Min
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AuditLog, Bank, BankLicense, EvaluatorNotification, LoginAttempt, Profile, SME, CriterionWeight, SMECriterionScore
from .permission import IsBankAdmin, IsApprovedUser, IsSuperAdmin
from .serializers import (
    AuditLogSerializer,
    BankAdminCreateSerializer,
    BankCreateSerializer,
    BankLicenseSerializer,
    BankSerializer,
    SMEListSerializer,
    EvaluatorSignupSerializer,
    EvaluatorNotificationSerializer,
)


# ==========================
# Health Check
# ==========================
@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "message": "Django is connected!"})


# ==========================
# Helpers
# ==========================
def _get_evaluator_profile_or_403(request):
    """
    Secondary role guard used inside view bodies.
    IsApprovedUser permission class is the primary gate;
    this helper provides the profile object and a clear error
    when the role check needs to be more specific.
    """
    user = getattr(request, "user", None)

    if not (user and user.is_authenticated and hasattr(user, "profile")):
        return None, Response(
            {"detail": "Authentication credentials were not provided."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    profile = user.profile

    if profile.role != "EVALUATOR":
        return None, Response(
            {"detail": "Evaluator access required."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not profile.is_approved:
        return None, Response(
            {"detail": "Pending bank admin approval."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not profile.is_active or not user.is_active:
        return None, Response(
            {"detail": "Account disabled. Contact bank admin."},
            status=status.HTTP_403_FORBIDDEN,
        )

    return profile, None


def _client_ip(request):
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _audit(request, action, target_user=None, detail=None, actor=None):
    user = actor if actor is not None else getattr(request, "user", None)
    if not getattr(user, "is_authenticated", False):
        user = None
    AuditLog.objects.create(
        actor=user,
        target_user=target_user,
        action=action,
        ip_address=_client_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:1000],
        detail=detail or {},
    )


def _login_attempt_key(username, request):
    return (username.strip().lower(), _client_ip(request))


def _get_active_login_lock(username, request):
    normalized_username, ip_address = _login_attempt_key(username, request)
    if not normalized_username:
        return None

    attempt = LoginAttempt.objects.filter(
        username=normalized_username,
        ip_address=ip_address,
        locked_until__gt=timezone.now(),
    ).first()
    return attempt


def _record_failed_login(username, request):
    normalized_username, ip_address = _login_attempt_key(username, request)
    if not normalized_username:
        return None

    now = timezone.now()
    attempt, _ = LoginAttempt.objects.get_or_create(
        username=normalized_username,
        ip_address=ip_address,
    )

    window_started = now - timezone.timedelta(seconds=settings.LOGIN_LOCKOUT_WINDOW_SECONDS)
    if attempt.first_failed_at < window_started:
        attempt.failed_count = 0
        attempt.first_failed_at = now
        attempt.locked_until = None

    attempt.failed_count += 1
    if attempt.failed_count >= settings.LOGIN_LOCKOUT_MAX_FAILURES:
        attempt.locked_until = now + timezone.timedelta(seconds=settings.LOGIN_LOCKOUT_SECONDS)

    attempt.save(update_fields=["failed_count", "first_failed_at", "locked_until", "last_failed_at"])
    _audit(
        request,
        "LOGIN_LOCKED" if attempt.locked_until else "LOGIN_FAILURE",
        detail={"username": normalized_username, "failed_count": attempt.failed_count},
        actor=None,
    )
    return attempt


def _clear_failed_login(username, request):
    normalized_username, ip_address = _login_attempt_key(username, request)
    LoginAttempt.objects.filter(username=normalized_username, ip_address=ip_address).delete()


def _get_sme_or_404(pk, bank):
    try:
        return SME.objects.select_related("evaluator", "scored_by", "bank").get(
            pk=pk, bank=bank
        )
    except SME.DoesNotExist:
        return None


def _block_if_scored_by_other(sme, evaluator_user):
    if sme.is_scored and sme.scored_by and sme.scored_by != evaluator_user:
        return Response(
            {"detail": "This SME was already scored by another evaluator."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


def _block_if_assigned_to_other_evaluator(sme, evaluator_user):
    if not sme.is_scored and sme.evaluator and sme.evaluator != evaluator_user:
        return Response(
            {"detail": f"Access denied. {sme.evaluator.username} should complete the evaluation."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


def _compute_capability_excel(scores_by_code, weights_by_code):
    """
    Excel-style capability calculation:
      normalized = score / 10
      weighted   = weight * normalized
      gap        = weight * (1 - normalized)
      capability = ROUND(SUM(weighted), 2)
    """
    rows = []
    total = Decimal("0")

    for code, weight_meta in weights_by_code.items():
        if isinstance(weight_meta, dict):
            w = weight_meta.get("weight", Decimal("0"))
            title = weight_meta.get("title", code)
        else:
            w = weight_meta
            title = code

        raw = scores_by_code.get(code)
        score = raw.get("score") if isinstance(raw, dict) else None

        if score is None:
            normalized = weighted = gap = None
        else:
            s = Decimal(str(score))
            normalized = s / Decimal("10")
            weighted = w * normalized
            gap = w * (Decimal("1") - normalized)
            total += weighted

        rows.append({
            "code": code,
            "title": title,
            "weight": float(w),
            "score": score,
            "normalized": float(normalized) if normalized is not None else None,
            "weighted": float(weighted) if weighted is not None else None,
            "gap": float(gap) if gap is not None else None,
        })

    capability = total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    weaknesses = [r for r in rows if r.get("gap") is not None and r["gap"] > 0]
    weaknesses.sort(key=lambda x: x["gap"], reverse=True)
    for i, row in enumerate(weaknesses, start=1):
        row["rank"] = i

    return float(capability), rows, weaknesses


def _criterion_code_sort_key(code):
    text = str(code or "")
    prefix = "".join(ch for ch in text if ch.isalpha())
    digits = "".join(ch for ch in text if ch.isdigit())
    number = int(digits) if digits else 0
    return (prefix, number, text)


def _serialize_sme_basic(sme):
    return {
        "id": sme.id,
        "name": sme.name,
        "br_number": sme.br_number,
        "industry": sme.industry,
        "is_scored": sme.is_scored,
        "total_score": sme.total_score,
        "evaluator": sme.evaluator.id if sme.evaluator else None,
        "evaluator_username": sme.evaluator.username if sme.evaluator else None,
        "scored_by": sme.scored_by.username if sme.scored_by else None,
    }


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


def _bank_audit_queryset(bank):
    return (
        AuditLog.objects.filter(
            Q(actor__profile__bank=bank)
            | Q(target_user__profile__bank=bank)
            | Q(detail__bank_id=bank.id)
        )
        .select_related("actor", "target_user")
        .distinct()
        .order_by("-created_at")
    )


def _license_payload(bank):
    license_obj = getattr(bank, "license", None)
    if not license_obj:
        return {
            "status": "MISSING",
            "is_valid": False,
            "seats": 0,
            "max_smes": 0,
            "max_evaluations": 0,
            "starts_on": None,
            "expires_on": None,
            "features": {},
            "active_users": 0,
            "smes_used": 0,
            "evaluations_used": 0,
            "days_remaining": None,
        }
    return BankLicenseSerializer(license_obj).data


def _bank_license_problem(bank):
    try:
        license_obj = BankLicense.objects.get(bank=bank)
    except BankLicense.DoesNotExist:
        return "Bank license is not configured."
    if not license_obj.is_valid:
        return "Software license period is over. Renew your software."
    active_users = Profile.objects.filter(bank=bank, is_active=True).count()
    if active_users >= license_obj.seats:
        return "Maximum evaluator level reached. Renew your software."
    return None


def _license_evaluations_used(license_obj):
    evaluations = SME.objects.filter(
        bank=license_obj.bank,
        is_active=True,
        is_scored=True,
        evaluated_at__isnull=False,
    ).only("evaluated_at")
    total = 0
    for sme in evaluations:
        evaluated_on = timezone.localtime(sme.evaluated_at).date()
        if license_obj.starts_on and evaluated_on < license_obj.starts_on:
            continue
        if license_obj.expires_on and evaluated_on > license_obj.expires_on:
            continue
        total += 1
    return total


def _license_evaluation_problem(bank):
    try:
        license_obj = BankLicense.objects.get(bank=bank)
    except BankLicense.DoesNotExist:
        return "Bank license is not configured."
    if not license_obj.is_valid:
        return "Software license period is over. Renew your software."

    if _license_evaluations_used(license_obj) >= license_obj.max_smes:
        return "Maximum evaluation level reached. Renew your software."
    return None


# ==========================
# Authentication / Account
# ==========================
class EvaluatorSignupView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ser = EvaluatorSignupSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(
            {"detail": "Account created. Waiting for bank admin approval."},
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]
    print("hiț login view")
    def post(self, request):
        username = request.data.get("username", "").strip()
        password = request.data.get("password", "")

        active_lock = _get_active_login_lock(username, request)
        if active_lock:
            seconds = max(1, int((active_lock.locked_until - timezone.now()).total_seconds()))
            return Response(
                {"detail": "Too many failed login attempts. Please try again later.", "retry_after_seconds": seconds},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        user = authenticate(username=username, password=password)
        print(f"Attempting login for user: {username}")
        if not user:
            _record_failed_login(username, request)
            return Response(
                {"detail": "Invalid username or password."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not user.is_active:
            return Response(
                {"detail": "Your account has been blocked. Please contact your bank admin."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if user.is_active and user.is_superuser:
            _clear_failed_login(username, request)
            token, _ = Token.objects.get_or_create(user=user)
            _audit(request, "LOGIN_SUCCESS", target_user=user, actor=user)

            return Response({
                "token": token.key,
                "role": "SUPER_ADMIN",
                "username": user.username,
                "bank_name": "",
                "bank_code": "",
            })

        try:
            profile = user.profile
        except Profile.DoesNotExist:
            return Response({"detail": "Profile not found."}, status=status.HTTP_403_FORBIDDEN)

        if profile.role == "EVALUATOR":
            if not profile.is_approved:
                return Response(
                    {"detail": "Your account is waiting for bank admin approval."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if not profile.is_active:
                return Response(
                    {"detail": "Your account has been blocked by the bank admin."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if profile.role == "BANK_ADMIN" and not profile.is_active:
            return Response({"detail": "Your account is inactive."}, status=status.HTTP_403_FORBIDDEN)

        _clear_failed_login(username, request)
        token, _ = Token.objects.get_or_create(user=user)
        _audit(request, "LOGIN_SUCCESS", target_user=user, actor=user)

        return Response({
            "token": token.key,
            "role": profile.role,
            "username": user.username,
            "bank_name": profile.bank.name if profile.bank else "",
            "bank_code": profile.bank.code if profile.bank else "",
            "license": _license_payload(profile.bank) if profile.bank else None,
        })


class SuperAdminOverviewView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        banks = Bank.objects.select_related("license").order_by("name")
        bank_admins = (
            Profile.objects.filter(role="BANK_ADMIN")
            .select_related("user", "bank")
            .order_by("bank__name", "user__username")
        )
        return Response({
            "banks": BankSerializer(banks, many=True).data,
            "bank_admins": [
                {
                    "profile_id": profile.id,
                    "user_id": profile.user.id,
                    "username": profile.user.username,
                    "first_name": profile.user.first_name,
                    "last_name": profile.user.last_name,
                    "email": profile.user.email,
                    "bank_id": profile.bank_id,
                    "bank_name": profile.bank.name,
                    "bank_code": profile.bank.code,
                    "is_active": profile.is_active and profile.user.is_active,
                }
                for profile in bank_admins
            ],
        })


class SuperAdminBankCreateView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def post(self, request):
        serializer = BankCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        bank = serializer.save()
        BankLicense.objects.get_or_create(
            bank=bank,
            defaults={
                "status": "TRIAL",
                "seats": 10,
                "max_smes": 100,
                "max_evaluations": 100,
                "starts_on": timezone.localdate(),
                "features": {"audit_logs": True, "csv_export": True, "pdf_reports": True},
            },
        )
        _audit(
            request,
            "BANK_CREATED",
            detail={"bank_id": bank.id, "bank_code": bank.code, "bank_name": bank.name},
        )
        return Response(BankSerializer(bank).data, status=status.HTTP_201_CREATED)


class SuperAdminBankAdminCreateView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def post(self, request):
        serializer = BankAdminCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        bank = Bank.objects.get(id=serializer.validated_data["bank_id"])
        license_problem = _bank_license_problem(bank)
        if license_problem:
            return Response({"detail": license_problem}, status=status.HTTP_403_FORBIDDEN)
        user = serializer.save()
        _audit(
            request,
            "BANK_ADMIN_CREATED",
            target_user=user,
            detail={"bank_id": user.profile.bank_id, "profile_id": user.profile.id},
        )
        return Response(
            {
                "user_id": user.id,
                "username": user.username,
                "bank_name": user.profile.bank.name,
                "bank_code": user.profile.bank.code,
            },
            status=status.HTTP_201_CREATED,
        )


class SuperAdminBankLicenseView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def post(self, request, bank_id):
        bank = get_object_or_404(Bank, id=bank_id)
        license_obj, _ = BankLicense.objects.get_or_create(bank=bank)
        serializer = BankLicenseSerializer(license_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(bank=bank)
        _audit(
            request,
            "LICENSE_UPDATED",
            detail={"bank_id": bank.id, "bank_code": bank.code, "license": serializer.data},
        )
        return Response(serializer.data)


class CurrentBankLicenseView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def get(self, request):
        profile = getattr(request.user, "profile", None)
        if not profile:
            return Response({"detail": "Profile not found."}, status=status.HTTP_403_FORBIDDEN)
        return Response(_license_payload(profile.bank))


class SuperAdminBankAdminPasswordResetView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def post(self, request, profile_id):
        try:
            profile = Profile.objects.select_related("user", "bank").get(
                id=profile_id,
                role="BANK_ADMIN",
            )
        except Profile.DoesNotExist:
            return Response({"detail": "Bank admin not found."}, status=status.HTTP_404_NOT_FOUND)

        new_password = request.data.get("new_password")
        if not new_password:
            return Response({"detail": "New password is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_password, user=profile.user)
        except Exception as e:
            errors = e.messages if hasattr(e, "messages") else [str(e)]
            return Response({"detail": " ".join(errors)}, status=status.HTTP_400_BAD_REQUEST)

        profile.user.set_password(new_password)
        profile.user.save(update_fields=["password"])
        Token.objects.filter(user=profile.user).delete()
        _audit(
            request,
            "BANK_ADMIN_PASSWORD_RESET",
            target_user=profile.user,
            detail={"profile_id": profile.id, "bank_id": profile.bank_id},
        )

        return Response(
            {
                "detail": "Bank admin password updated successfully.",
                "username": profile.user.username,
                "bank_name": profile.bank.name,
            }
        )


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        old_password = request.data.get("old_password")
        new_password = request.data.get("new_password")

        if not old_password or not new_password:
            return Response(
                {"detail": "Old password and new password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not user.check_password(old_password):
            return Response({"detail": "Old password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_password, user=user)
        except Exception as e:
            errors = e.messages if hasattr(e, "messages") else [str(e)]
            return Response({"detail": " ".join(errors)}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save()

        # Invalidate existing token so the user must log in again with the new password
        Token.objects.filter(user=user).delete()
        _audit(request, "PASSWORD_CHANGED", target_user=user)

        return Response({"detail": "Password changed successfully. Please log in again."})


class AuditLogListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if user.is_superuser:
            queryset = AuditLog.objects.select_related("actor", "target_user").order_by("-created_at")
        elif (
            user.is_active
            and hasattr(user, "profile")
            and user.profile.role == "BANK_ADMIN"
            and user.profile.is_active
        ):
            queryset = _bank_audit_queryset(user.profile.bank)
        else:
            return Response({"detail": "Bank admin access required."}, status=status.HTTP_403_FORBIDDEN)

        action = (request.GET.get("action") or "").strip()
        q = (request.GET.get("q") or "").strip()
        if action:
            queryset = queryset.filter(action=action)
        if q:
            queryset = queryset.filter(
                Q(actor__username__icontains=q)
                | Q(target_user__username__icontains=q)
                | Q(ip_address__icontains=q)
                | Q(action__icontains=q)
            )

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(AuditLogSerializer(page, many=True).data)


# ==========================
# Bank Admin: Evaluator Approval
# ==========================
class PendingEvaluatorsView(APIView):
    permission_classes = [IsAuthenticated, IsBankAdmin]

    def get(self, request):
        bank = request.user.profile.bank
        pending = (
            Profile.objects.filter(bank=bank, role="EVALUATOR", is_approved=False)
            .select_related("user")
            .order_by("-id")
        )
        data = [
            {
                "profile_id": p.id,
                "user_id": p.user.id,
                "username": p.user.username,
                "first_name": p.user.first_name,
                "last_name": p.user.last_name,
                "email": p.user.email,
                "is_active": p.is_active,
                "is_approved": p.is_approved,
            }
            for p in pending
        ]
        return Response(data)


class ApproveEvaluatorView(APIView):
    permission_classes = [IsAuthenticated, IsBankAdmin]

    def post(self, request, profile_id):
        bank = request.user.profile.bank
        try:
            profile = Profile.objects.select_related("user").get(
                id=profile_id, bank=bank, role="EVALUATOR"
            )
        except Profile.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        license_problem = _bank_license_problem(bank)
        if license_problem:
            return Response({"detail": license_problem}, status=status.HTTP_403_FORBIDDEN)

        profile.is_approved = True
        profile.is_active = True
        profile.user.is_active = True
        profile.user.save(update_fields=["is_active"])
        profile.save(update_fields=["is_approved", "is_active"])

        EvaluatorNotification.objects.create(
            user=profile.user,
            title="Account Approved",
            message="Your evaluator account has been approved. You can now log in and start using the system.",
        )
        _audit(
            request,
            "EVALUATOR_APPROVED",
            target_user=profile.user,
            detail={"profile_id": profile.id, "bank_id": bank.id},
        )
        return Response({"detail": "Evaluator approved."})


class DisapproveEvaluatorView(APIView):
    permission_classes = [IsAuthenticated, IsBankAdmin]

    def post(self, request, profile_id):
        bank = request.user.profile.bank
        try:
            profile = Profile.objects.select_related("user").get(
                id=profile_id, bank=bank, role="EVALUATOR"
            )
        except Profile.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        profile.is_approved = False
        profile.is_active = False
        profile.user.is_active = False
        profile.user.save(update_fields=["is_active"])
        profile.save(update_fields=["is_approved", "is_active"])

        # Invalidate token so disapproved user is immediately logged out
        Token.objects.filter(user=profile.user).delete()

        EvaluatorNotification.objects.create(
            user=profile.user,
            title="Account Disapproved",
            message="Your evaluator account request was disapproved by the bank admin. You cannot log in to the system.",
        )
        _audit(
            request,
            "EVALUATOR_DISAPPROVED",
            target_user=profile.user,
            detail={"profile_id": profile.id, "bank_id": bank.id},
        )
        return Response({"detail": "Evaluator disapproved and blocked."})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def block_evaluator(request, profile_id):
    profile = get_object_or_404(
        Profile.objects.select_related("user"),
        id=profile_id,
        role="EVALUATOR",
        bank=request.user.profile.bank,
    )

    profile.is_active = False
    profile.user.is_active = False
    profile.user.save(update_fields=["is_active"])
    profile.save(update_fields=["is_active"])

    # Invalidate token so blocked user is immediately logged out
    Token.objects.filter(user=profile.user).delete()

    _audit(
        request,
        "EVALUATOR_BLOCKED",
        target_user=profile.user,
        detail={"profile_id": profile.id, "bank_id": request.user.profile.bank_id},
    )

    return Response({"message": "Evaluator blocked successfully."})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def unblock_evaluator(request, profile_id):
    profile = get_object_or_404(
        Profile.objects.select_related("user"),
        id=profile_id,
        role="EVALUATOR",
        bank=request.user.profile.bank,
    )

    if not profile.is_approved:
        return Response(
            {"detail": "This evaluator is not approved yet."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    profile.is_active = True
    profile.user.is_active = True
    profile.user.save(update_fields=["is_active"])
    profile.save(update_fields=["is_active"])

    _audit(
        request,
        "EVALUATOR_UNBLOCKED",
        target_user=profile.user,
        detail={"profile_id": profile.id, "bank_id": request.user.profile.bank_id},
    )

    return Response({"message": "Evaluator unblocked successfully."})


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def search_evaluators(request):
    q = request.GET.get("q", "").strip()
    bank = request.user.profile.bank

    queryset = (
        Profile.objects.filter(bank=bank, role="EVALUATOR")
        .select_related("user", "bank")
        .order_by("user__username")
    )

    if q:
        queryset = queryset.filter(user__username__icontains=q)

    data = [
        {
            "profile_id": p.id,
            "user_id": p.user.id,
            "username": p.user.username,
            "first_name": p.user.first_name,
            "last_name": p.user.last_name,
            "email": p.user.email,
            "is_approved": p.is_approved,
            "is_active": p.is_active,
            "bank_name": p.bank.name if p.bank else "",
        }
        for p in queryset
    ]
    return Response(data)


# ==========================
# Evaluator SME APIs
# ==========================
class SMEReportByBRView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def get(self, request):
        br = (request.GET.get("br") or "").strip()
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        if not br:
            return Response({"detail": "BR number required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            sme = SME.objects.select_related("evaluator", "scored_by").get(
                br_number=br, bank=profile.bank
            )
        except SME.DoesNotExist:
            return Response(
                {"detail": "SME not found. Please go to the Scoring part and register and start scoring."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not sme.is_scored:
            return Response(
                {"detail": "Scoring has not been done. Please go to the Scoring part and start scoring."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(_serialize_sme_basic(sme))


class SMEScoringByBRView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def get(self, request):
        br = (request.GET.get("br") or "").strip()
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        if not br:
            return Response({"detail": "BR number required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            sme = SME.objects.select_related("evaluator", "scored_by").get(
                br_number=br, bank=profile.bank
            )
        except SME.DoesNotExist:
            return Response(
                {"detail": "SME not found. Please go to the Scoring part and register and start scoring."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if sme.is_scored:
            return Response(
                {"detail": "This evaluation has already been completed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        block = _block_if_assigned_to_other_evaluator(sme, profile.user)
        if block:
            return block

        return Response(_serialize_sme_basic(sme))


class EvaluatorSMEsView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def get(self, request):
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err
        smes = SME.objects.filter(bank=profile.bank).order_by("-id")
        return Response(SMEListSerializer(smes, many=True).data)


class EvaluatorSummaryView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def get(self, request):
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        qs = SME.objects.filter(bank=profile.bank)
        total = qs.count()
        scored = qs.filter(is_scored=True).count()
        pending = qs.filter(is_scored=False).count()

        # Use DB aggregation instead of Python loop
        result = qs.filter(is_scored=True, total_score__isnull=False).aggregate(
            avg=Avg("total_score")
        )
        avg = round(result["avg"] or 0, 2)

        return Response({
            "total_smes": total,
            "scored_smes": scored,
            "pending_smes": pending,
            "avg_score": avg,
        })


class SMECreateView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def post(self, request):
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        license_obj = getattr(profile.bank, "license", None)
        if not license_obj or not license_obj.is_valid:
            return Response({"detail": "Software license period is over. Renew your software."}, status=status.HTTP_403_FORBIDDEN)
        if SME.objects.filter(bank=profile.bank, is_active=True).count() >= license_obj.max_smes:
            return Response({"detail": "Maximum SME registration level reached. Renew your software."}, status=status.HTTP_403_FORBIDDEN)

        name = request.data.get("name")
        br = request.data.get("br_number")
        industry = request.data.get("industry", "")

        if not name or not br:
            return Response(
                {"detail": "name and br_number are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if SME.objects.filter(bank=profile.bank, br_number=br).exists():
            return Response(
                {"detail": "This SME has already been registered."},
                status=status.HTTP_409_CONFLICT,
            )

        sme = SME.objects.create(
            name=name,
            br_number=br,
            industry=industry,
            bank=profile.bank,
            evaluator=profile.user,
        )
        _audit(
            request,
            "SME_CREATED",
            target_user=profile.user,
            detail={"sme_id": sme.id, "bank_id": profile.bank_id, "br_number": sme.br_number},
        )

        return Response(
            {
                "message": "SME registered successfully",
                "sme": {
                    "id": sme.id,
                    "name": sme.name,
                    "br_number": sme.br_number,
                    "industry": sme.industry,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class SMECriterionScoresView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def get(self, request, pk):
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        sme = _get_sme_or_404(pk, profile.bank)
        if not sme:
            return Response({"detail": "SME not found."}, status=status.HTTP_404_NOT_FOUND)

        block = _block_if_assigned_to_other_evaluator(sme, profile.user)
        if block:
            return block

        items = SMECriterionScore.objects.filter(
            sme=sme, evaluator=profile.user
        ).order_by("criterion_code")

        out = [
            {"code": item.criterion_code, "score": item.score, "notes": item.notes, "followup": item.followup}
            for item in items
        ]
        return Response({"sme_id": sme.id, "count": len(out), "scores": out})

    def post(self, request, pk):
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        sme = _get_sme_or_404(pk, profile.bank)
        if not sme:
            return Response({"detail": "SME not found."}, status=status.HTTP_404_NOT_FOUND)

        block = _block_if_scored_by_other(sme, profile.user)
        if block:
            return block

        block = _block_if_assigned_to_other_evaluator(sme, profile.user)
        if block:
            return block

        if sme.evaluator is None:
            sme.evaluator = profile.user
            sme.save(update_fields=["evaluator"])

        payload = request.data.get("scores")
        if not isinstance(payload, list):
            return Response({"detail": "scores must be a list."}, status=status.HTTP_400_BAD_REQUEST)

        valid_codes = set(CriterionWeight.objects.filter(is_active=True).values_list("code", flat=True))

        saved = 0
        for row in payload:
            code = (row.get("code") or "").strip()
            if not code or (valid_codes and code not in valid_codes):
                continue

            score = row.get("score")
            notes = row.get("notes", "") or ""
            followup = bool(row.get("followup", False))

            if score is not None:
                try:
                    score = int(score)
                except Exception:
                    score = None

            if score is not None and (score < 1 or score > 10):
                return Response(
                    {"detail": f"{code} score must be between 1 and 10."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            obj, _ = SMECriterionScore.objects.get_or_create(
                sme=sme,
                evaluator=profile.user,
                criterion_code=code,
                defaults={"score": score, "notes": notes, "followup": followup},
            )
            obj.score = score
            obj.notes = notes
            obj.followup = followup
            obj.save(update_fields=["score", "notes", "followup", "updated_at"])
            saved += 1

        _audit(
            request,
            "SME_SCORES_SAVED",
            target_user=profile.user,
            detail={"sme_id": sme.id, "bank_id": profile.bank_id, "saved": saved},
        )
        return Response({"detail": "Saved.", "saved": saved})


# ==========================
# Capability Submit / Result
# ==========================
class SMESubmitCapabilityView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def post(self, request, pk):
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        sme = _get_sme_or_404(pk, profile.bank)
        if not sme:
            return Response({"detail": "SME not found."}, status=status.HTTP_404_NOT_FOUND)

        block = _block_if_scored_by_other(sme, profile.user)
        if block:
            return block

        block = _block_if_assigned_to_other_evaluator(sme, profile.user)
        if block:
            return block

        if sme.evaluator is None:
            sme.evaluator = profile.user
            sme.save(update_fields=["evaluator"])

        license_problem = _license_evaluation_problem(profile.bank)
        if license_problem and (not sme.is_scored or "period is over" in license_problem):
            return Response({"detail": license_problem}, status=status.HTTP_403_FORBIDDEN)

        weights = sorted(
            CriterionWeight.objects.filter(is_active=True),
            key=lambda item: _criterion_code_sort_key(item.code),
        )
        if not weights:
            return Response(
                {"detail": "No weights found. Insert CriterionWeight rows first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        weights_by_code = {
            w.code: {"weight": Decimal(str(w.weight)), "title": w.title}
            for w in weights
        }
        score_rows = SMECriterionScore.objects.filter(sme=sme, evaluator=profile.user)
        scores_by_code = {
            s.criterion_code: {"score": s.score, "notes": s.notes, "followup": s.followup}
            for s in score_rows
        }

        missing = [
            code for code in weights_by_code if scores_by_code.get(code, {}).get("score") is None
        ]
        if missing:
            return Response(
                {"detail": "All criteria must be scored before submit.", "missing": missing},
                status=status.HTTP_400_BAD_REQUEST,
            )

        capability, rows, weaknesses = _compute_capability_excel(scores_by_code, weights_by_code)

        sme.total_score = capability
        sme.is_scored = True
        sme.scored_by = profile.user
        sme.evaluator = profile.user
        sme.evaluated_at = timezone.now()
        sme.save(update_fields=["total_score", "is_scored", "scored_by", "evaluator", "evaluated_at"])
        _audit(
            request,
            "SME_SUBMITTED",
            target_user=profile.user,
            detail={
                "sme_id": sme.id,
                "bank_id": profile.bank_id,
                "br_number": sme.br_number,
                "capability_score": capability,
            },
        )

        return Response({
            "message": "Submitted.",
            "sme_id": sme.id,
            "capability_score": capability,
            "capability_percent": round(capability * 100, 0),
            "rows": rows,
            "weaknesses": weaknesses,
        })


class SMECapabilityResultView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def get(self, request, pk):
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        sme = _get_sme_or_404(pk, profile.bank)
        if not sme:
            return Response({"detail": "SME not found."}, status=status.HTTP_404_NOT_FOUND)

        block = _block_if_assigned_to_other_evaluator(sme, profile.user)
        if block:
            return block

        weights = sorted(
            CriterionWeight.objects.filter(is_active=True),
            key=lambda item: _criterion_code_sort_key(item.code),
        )
        if not weights:
            return Response(
                {"detail": "No weights found. Insert CriterionWeight rows first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        weights_by_code = {
            w.code: {"weight": Decimal(str(w.weight)), "title": w.title}
            for w in weights
        }
        score_rows = SMECriterionScore.objects.filter(sme=sme, evaluator=profile.user)
        scores_by_code = {
            s.criterion_code: {"score": s.score, "notes": s.notes, "followup": s.followup}
            for s in score_rows
        }

        capability, rows, weaknesses = _compute_capability_excel(scores_by_code, weights_by_code)

        return Response({
            "sme_id": sme.id,
            "sme_name": sme.name,
            "is_scored": sme.is_scored,
            "stored_total_score": sme.total_score,
            "capability_score": capability,
            "capability_percent": round(capability * 100, 0),
            "rows": rows,
            "weaknesses": weaknesses,
        })


# ==========================
# Bank Admin Dashboard APIs
# All now use IsBankAdmin permission class — no manual role checks
# ==========================
@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def bank_admin_dashboard_summary(request):
    bank = request.user.profile.bank

    smes = SME.objects.filter(bank=bank, is_active=True)
    scored_smes_qs = smes.filter(is_scored=True, total_score__isnull=False)
    evaluators = Profile.objects.filter(bank=bank, role="EVALUATOR")

    stats = scored_smes_qs.aggregate(
        average_score=Avg("total_score"),
        highest_score=Max("total_score"),
        lowest_score=Min("total_score"),
    )

    top_industry_row = (
        scored_smes_qs.exclude(industry="")
        .values("industry")
        .annotate(avg_score=Avg("total_score"), total=Count("id"))
        .order_by("-avg_score", "-total")
        .first()
    )

    return Response({
        "total_smes": smes.count(),
        "scored_smes": scored_smes_qs.count(),
        "pending_smes": smes.filter(is_scored=False).count(),
        "approved_evaluators": evaluators.filter(is_approved=True, is_active=True).count(),
        "pending_evaluators": evaluators.filter(is_approved=False).count(),
        "average_score": round(stats["average_score"] or 0, 2),
        "highest_score": round(stats["highest_score"] or 0, 2),
        "lowest_score": round(stats["lowest_score"] or 0, 2),
        "top_industry": top_industry_row["industry"] if top_industry_row else "N/A",
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def bank_admin_industry_analysis(request):
    bank = request.user.profile.bank

    # Single aggregation query instead of N queries in a loop
    industry_stats = (
        SME.objects.filter(bank=bank, is_active=True, is_scored=True, total_score__isnull=False)
        .values("industry")
        .annotate(
            total_smes=Count("id"),
            average_score=Avg("total_score"),
            highest_score=Max("total_score"),
            lowest_score=Min("total_score"),
        )
    )

    # Fetch all scored SMEs once and group in Python
    all_smes = list(
        SME.objects.filter(bank=bank, is_active=True, is_scored=True, total_score__isnull=False)
        .order_by("name")
        .values("id", "name", "br_number", "industry", "total_score")
    )

    smes_by_industry = {}
    for sme in all_smes:
        smes_by_industry.setdefault(sme["industry"], []).append(sme)

    data = []
    for row in industry_stats:
        industry = row["industry"] or "Unknown"
        industry_smes = smes_by_industry.get(row["industry"], [])
        sorted_smes = sorted(industry_smes, key=lambda s: (-(s["total_score"] or 0), s["br_number"]))

        data.append({
            "industry": industry,
            "total_smes": row["total_smes"],
            "average_score": round(row["average_score"] or 0, 2),
            "highest_score": round(row["highest_score"] or 0, 2),
            "lowest_score": round(row["lowest_score"] or 0, 2),
            "highest_sme_br": sorted_smes[0]["br_number"] if sorted_smes else None,
            "lowest_sme_br": sorted_smes[-1]["br_number"] if sorted_smes else None,
            "smes": [
                {
                    "id": s["id"],
                    "name": s["name"],
                    "br_number": s["br_number"],
                    "total_score": round(s["total_score"] or 0, 2),
                }
                for s in industry_smes
            ],
        })

    return Response(data)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def bank_admin_evaluator_analysis(request):
    bank = request.user.profile.bank

    evaluator_profiles = (
        Profile.objects.filter(bank=bank, role="EVALUATOR")
        .select_related("user")
        .order_by("user__username")
    )

    score_rows = (
        SME.objects.filter(bank=bank, is_active=True, is_scored=True, total_score__isnull=False, scored_by__isnull=False)
        .values("scored_by__id", "scored_by__username")
        .annotate(
            total_scored=Count("id"),
            average_score=Avg("total_score"),
            highest_score=Max("total_score"),
            lowest_score=Min("total_score"),
        )
        .order_by("scored_by__username")
    )

    score_map = {
        row["scored_by__id"]: {
            "evaluator_id": row["scored_by__id"],
            "username": row["scored_by__username"],
            "total_scored": row["total_scored"],
            "average_score": round(row["average_score"] or 0, 2),
            "highest_score": round(row["highest_score"] or 0, 2),
            "lowest_score": round(row["lowest_score"] or 0, 2),
        }
        for row in score_rows
    }

    evaluators = []
    for profile in evaluator_profiles:
        item = score_map.get(
            profile.user.id,
            {
                "evaluator_id": profile.user.id,
                "username": profile.user.username,
                "total_scored": 0,
                "average_score": 0,
                "highest_score": 0,
                "lowest_score": 0,
            },
        )
        item["profile_id"] = profile.id
        item["is_approved"] = profile.is_approved
        item["is_active"] = profile.is_active
        evaluators.append(item)

    return Response({
        "approved_evaluators": evaluator_profiles.filter(is_approved=True, is_active=True).count(),
        "pending_evaluators": evaluator_profiles.filter(is_approved=False).count(),
        "total_evaluators": evaluator_profiles.count(),
        "evaluators": evaluators,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def bank_admin_evaluator_score_distribution(request, evaluator_id):
    bank = request.user.profile.bank

    evaluator_profile = get_object_or_404(
        Profile.objects.select_related("user"),
        bank=bank,
        role="EVALUATOR",
        user__id=evaluator_id,
    )

    scored_smes = SME.objects.filter(
        bank=bank, is_active=True, is_scored=True, total_score__isnull=False, scored_by=evaluator_profile.user
    ).order_by("name")

    stats = scored_smes.aggregate(
        average_score=Avg("total_score"),
        highest_score=Max("total_score"),
        lowest_score=Min("total_score"),
    )

    return Response({
        "evaluator_id": evaluator_profile.user.id,
        "profile_id": evaluator_profile.id,
        "username": evaluator_profile.user.username,
        "is_approved": evaluator_profile.is_approved,
        "is_active": evaluator_profile.is_active,
        "total_scored": scored_smes.count(),
        "average_score": round(stats["average_score"] or 0, 2),
        "highest_score": round(stats["highest_score"] or 0, 2),
        "lowest_score": round(stats["lowest_score"] or 0, 2),
        "smes": [
            {
                "sme_id": sme.id,
                "sme_name": sme.name,
                "br_number": sme.br_number,
                "industry": sme.industry or "Unknown",
                "total_score": round(sme.total_score or 0, 2),
            }
            for sme in scored_smes
        ],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def bank_admin_criterion_analysis(request):
    bank = request.user.profile.bank

    # Fetch everything in one query and group in Python — no N+1 loop
    all_scores = list(
        SMECriterionScore.objects.filter(
            sme__bank=bank, sme__is_active=True, score__isnull=False
        )
        .select_related("sme")
        .order_by("criterion_code", "sme__br_number")
        .values("criterion_code", "sme__id", "sme__br_number", "score")
    )

    from collections import defaultdict
    grouped = defaultdict(list)
    for row in all_scores:
        grouped[row["criterion_code"]].append(row)

    data = []
    for code, rows in sorted(grouped.items()):
        scores_list = [r["score"] for r in rows]
        avg = round(sum(scores_list) / len(scores_list), 2) if scores_list else 0
        data.append({
            "criterion_code": code,
            "average_score": avg,
            "total_entries": len(rows),
            "scores": [{"sme_id": r["sme__id"], "br_number": r["sme__br_number"], "score": r["score"]} for r in rows],
        })

    return Response(data)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def bank_admin_sme_list(request):
    bank = request.user.profile.bank

    smes = (
        SME.objects.filter(bank=bank, is_active=True)
        .order_by("name")
        .values("id", "name", "br_number", "industry", "is_scored", "total_score")
    )

    return Response([
        {
            "id": row["id"],
            "name": row["name"],
            "br_number": row["br_number"],
            "industry": row["industry"] or "Unknown",
            "is_scored": row["is_scored"],
            "total_score": round(row["total_score"] or 0, 2),
        }
        for row in smes
    ])


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def bank_admin_sme_export(request):
    bank = request.user.profile.bank
    queryset = (
        SME.objects.filter(bank=bank, is_active=True)
        .select_related("evaluator", "scored_by")
        .order_by("name")
    )

    status_filter = (request.GET.get("status") or "").strip().lower()
    industry = (request.GET.get("industry") or "").strip()
    q = (request.GET.get("q") or "").strip()

    if status_filter == "scored":
        queryset = queryset.filter(is_scored=True)
    elif status_filter == "pending":
        queryset = queryset.filter(is_scored=False)
    if industry:
        queryset = queryset.filter(industry__iexact=industry)
    if q:
        queryset = queryset.filter(Q(name__icontains=q) | Q(br_number__icontains=q))

    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="sme-portfolio-export.csv"'
    writer = csv.writer(response)
    writer.writerow([
        "SME Name",
        "BR Number",
        "Industry",
        "Status",
        "Capability Score",
        "Evaluator",
        "Scored By",
    ])
    for sme in queryset:
        writer.writerow([
            sme.name,
            sme.br_number,
            sme.industry or "Unknown",
            "Scored" if sme.is_scored else "Pending",
            round(sme.total_score or 0, 2),
            sme.evaluator.username if sme.evaluator else "",
            sme.scored_by.username if sme.scored_by else "",
        ])

    _audit(
        request,
        "REPORT_EXPORTED",
        detail={
            "bank_id": bank.id,
            "report": "sme_portfolio",
            "filters": {"status": status_filter, "industry": industry, "q": q},
        },
    )
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsBankAdmin])
def bank_admin_sme_comparison(request):
    bank = request.user.profile.bank
    ids = request.GET.get("ids", "")
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]

    # Cap at 20 to prevent denial-of-service via huge IN queries
    id_list = id_list[:20]

    smes = (
        SME.objects.filter(bank=bank, is_active=True, id__in=id_list)
        .prefetch_related("criterion_scores")
        .order_by("name")
    )

    data = []
    for sme in smes:
        criteria = {
            row.criterion_code: row.score
            for row in sme.criterion_scores.all()
            if row.score is not None
        }
        data.append({
            "id": sme.id,
            "name": sme.name,
            "br_number": sme.br_number,
            "industry": sme.industry or "Unknown",
            "is_scored": sme.is_scored,
            "total_score": round(sme.total_score or 0, 2),
            "criteria": criteria,
        })

    return Response(data)


# ==========================
# Evaluator Notifications
# ==========================
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def evaluator_notifications(request):
    items = (
        EvaluatorNotification.objects.filter(user=request.user)
        .exclude(title__in=["Account Blocked", "Account Unblocked"])
        .order_by("-created_at")
    )
    serializer = EvaluatorNotificationSerializer(items, many=True)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_evaluator_notifications_read(request):
    EvaluatorNotification.objects.filter(user=request.user, is_read=False).update(is_read=True)
    return Response({"detail": "Notifications marked as read."})


class SMEDetailForScoringView(APIView):
    permission_classes = [IsAuthenticated, IsApprovedUser]

    def get(self, request, pk):
        profile, err = _get_evaluator_profile_or_403(request)
        if err:
            return err

        try:
            sme = SME.objects.select_related("evaluator", "scored_by").get(
                pk=pk, bank=profile.bank
            )
        except SME.DoesNotExist:
            return Response({"detail": "SME not found."}, status=status.HTTP_404_NOT_FOUND)

        block = _block_if_assigned_to_other_evaluator(sme, profile.user)
        if block:
            return block

        return Response({
            "id": sme.id,
            "name": sme.name,
            "br_number": sme.br_number,
            "industry": sme.industry,
            "is_scored": sme.is_scored,
            "total_score": sme.total_score,
        })
