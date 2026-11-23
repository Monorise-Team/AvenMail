-- Baza aven_mail i jej role (ADR-0037, ADR-0096), tak jak w MonoriseCore:
-- - aven_mail_owner jest właścicielem tabel i uruchamia migracje,
-- - aven_mail_app to rola aplikacji: nie jest właścicielem tabel i nie ma BYPASSRLS, więc RLS obowiązuje ją zawsze.
-- Hasła tylko do pracy lokalnej i CI; na serwerze role i hasła zakłada infrastruktura.
CREATE ROLE aven_mail_owner LOGIN PASSWORD 'aven_mail_owner';
CREATE ROLE aven_mail_app LOGIN PASSWORD 'aven_mail_app';
CREATE DATABASE aven_mail OWNER aven_mail_owner;
-- Osobna baza testów lokalnych, żeby testy nie mieszały danych z pracą w przeglądarce
CREATE DATABASE aven_mail_test OWNER aven_mail_owner;
