access db -> 
docker exec -it imandee_sme_test_app-db-1 psql -U postgres -d sme_scoring


docker exec -it sme-postgres psql -U postgres -d sme_scoring


INSERT INTO auth_user (
id,
password,
last_login,
is_superuser,
username,
first_name,
last_name,
email,
is_staff,
is_active,
date_joined
) VALUES (
1,
'1234',
NULL,
TRUE,
'admin',
'Admin',
'User',
'admin@example.com',
TRUE,
TRUE,
NOW()
);

ssh -i ~/.ssh/sme-app.pem ubuntu@100.59.187.125


 kill -9 $(lsof -ti :8000)


 nano .env

 # disk space 

 df -h
 docker system df
 docker compose down
 docker system prune -a
 docker builder prune -a

 docker compose up -d --build
 docker compose down
 docker compose up -d


 
 python manage.py makemigrations 
 python manage.py migrate
 python manage.py createsuperuser