# Kopie kodu i danych Nimble

## Kod — odpowiedzialność agenta

Użytkownik nie przechowuje lokalnego repozytorium ani nie wykonuje pushów.
Po każdym ukończonym etapie agent zapisuje pełny checkpoint poza środowiskiem
roboczym i potwierdza wynik zapisu. Sam commit lub utworzenie ZIP na dysku roboczym
nie daje trwałej kopii. Nie usuwać wcześniejszej potwierdzonej kopii.

Po zapisaniu wszystkich zamierzonych zmian w Git:

```bash
python3 scripts/checkpoint-code.py /absolutna/sciezka/poza/repo/NIMBLE-FULL-CODE-wersja.zip
```

Skrypt odmawia pracy z brudnym drzewem, nadpisania istniejącego archiwum lub
zapisania go wewnątrz repozytorium. Dołącza wszystkie śledzone źródła i pełną
osiągalną historię Git, sprawdza świeży klon, HEAD, drzewo oraz integralność.
Agent następnie przesyła cały ZIP do trwałego miejsca zapisu i zapisuje potwierdzone
ID wraz z SHA w raporcie przekazania. Nie zakłada, że użytkownik zrobi to później.
Nie udostępnia publicznie nowych źródeł, jeżeli taka operacja została zablokowana.

Archiwum nie zawiera node_modules, nieśledzonych sekretów ani danych produkcyjnych.
Nie zastępuje kopii bazy i zdjęć. Nieprzesłany checkpoint ma status niezabezpieczony.
Przed rozpoczęciem następnego etapu wymagane jest potwierdzenie trwałego zapisu
poprzedniego. Identyfikatory kopii i wynik sprawdzenia są w raporcie końcowym.

## Dane lokalu — backup.sh

Skrypt jest dla GNU/Linux, Bash, Docker Compose, flock, tar, gzip i sha256sum.
Przykład dla wyłącznie zainstalowanego stosu main:

```bash
bash deploy/backup.sh main
```

Bez argumentów wykonuje main i test. Brak konfiguracji wybranego stosu daje błąd;
nie ma cichego pominięcia. Można wskazać NIMBLE_BACKUP_DEST (domyślnie
/var/backups/nimble) i NIMBLE_BACKUP_KEEP_DAYS (domyślnie 14).

**Backup na krótko zatrzymuje app i workery** na czas dumpu bazy i zdjęć.
To zmienia zachowanie starego skryptu: zaplanuj okno utrzymaniowe, przed podpięciem
do crona wykonaj próbę na izolowanej instancji. Nie uruchamiano go na serwerze
użytkownika. Zakłada, że jedynymi zapisującymi do bazy/zdjęć są API i workery tego
stosu. Zewnętrzni zapisujący wymagają osobnego zatrzymania. Nie uruchamiać równolegle
z wdrożeniem ani ręczną zmianą stanu aplikacji.

App uruchomiona przed backupem jest ponownie uruchamiana także po błędzie.
App zatrzymana przez operatora pozostaje zatrzymana. Nieudany restart jest alarmem
i wynikiem niezerowym; skrypt nie gwarantuje restartu po SIGKILL, awarii hosta lub
demona Docker. Kontrola restartu oznacza powodzenie polecenia Compose start,
nie pełną kontrolę zdrowia aplikacji — to pozostaje częścią próby R08.

Każdy kompletny katalog *.backup zawiera:

- database.sql.gz — dump z opcjami --clean --if-exists;
- media.tar.gz — menu-images i task-photos z wolumenów app;
- MANIFEST.txt — stos, czas UTC i SHA checkoutu (UNKNOWN, gdy brak Git);
- SHA256SUMS — sumy kontrolne wszystkich trzech plików.

SHA checkoutu nie dowodzi, że aktualnie działający obraz jest z niego zbudowany.
Dowód zgodnej wersji obrazu i końcową próbę restore trzeba zamknąć w R08.
Pliki są tworzone z umask 077; zdjęcia prywatne nie są publikowane.
Sprawdzenie gzip/tar i sumy nie oznacza, że SQL da się poprawnie odtworzyć.

Komplet jest publikowany przez przeniesienie katalogu na tym samym filesystemie
dopiero po wykonaniu wszystkich kopii i próbie wznowienia app. Retencja obejmuje
wyłącznie kompletne katalogi tego stosu po jego udanym backupie, nigdy nowy katalog.
Nie kasuje starszych płaskich *.sql.gz — ich usunięcie wymaga wcześniejszej próby
pełnego odtworzenia. Jeden proces backupu blokuje drugi dla tego samego DEST.

Kopie lokalne na tym samym serwerze nie chronią przed utratą całego hosta.
R08 musi objąć niezależne miejsce składowania, politykę retencji i rzeczywistą próbę
odtworzenia bazy oraz prywatnych zdjęć do pustego środowiska. Nie twierdzimy,
że działający serwer, cron lub zewnętrzne składowanie zostały skonfigurowane.

## Test bezpieczeństwa skryptu

```bash
node --test scripts/test-backup.test.mjs
```

Test uruchamia prawdziwy skrypt Bash z izolowanym adapterem Docker i rzeczywistymi
narzędziami gzip/tar/sha256sum. Sprawdza awarie, izolację retencji, zachowanie stanu
app i zawartość kopii. Nie jest to jeszcze test Docker/PostgreSQL ani restore SQL.
