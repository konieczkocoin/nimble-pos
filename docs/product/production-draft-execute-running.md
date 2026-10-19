# Zadanie05 — wykonanie szkicu i powiązana partia

18.10.2026, baza8c8e641, gałąź recovery/production-drafts.
Kandydat rozwojowy, bez scalenia/wdrożenia i bez zamknięcia natywnego01.

## Implementacja

POST /venues/:venueId/production/drafts/:id/execute przyjmuje revision,
actualYield, reason, opcjonalne dane partii i idempotencyKey. Nie przyjmuje
zmienionych założeń planu; receptura/output/partie/oczekiwany uzysk pochodzą
z zablokowanego szkicu. Aktualne owner/inventory.manage i izolacja lokalu
sprawdzane także przed replay.

Kolejność: blokada operacji zapasu lokalu → idempotencja → wiersz szkicu
FOR UPDATE → zasoby w posortowanej kolejności. Wymagany DRAFT i zgodna
rewizja. Wspólna funkcja tworzenia partii obsługuje również zwykłą produkcję;
ponownie sprawdza zapas/rezerwacje, ilości i cykle. Dla szkicu dodatkowo
wymaga śledzonych i dostępnych zasobów. Nieodebrana dostawa nie jest zapasem.

Jedna transakcja: ruchy/wycena, partia z draftId, audyt, szkic EXECUTED
z batchId, aktorem/czasem i nową rewizją oraz odpowiedź idempotencji.
Niepowodzenie cofa wszystkie skutki. Ten sam klucz/payload odtwarza wynik;
inny klucz na wykonanym szkicu odrzucany. Anulowanie i wykonanie konkurują
o ten sam wiersz, więc nie mogą oba zakończyć się sukcesem.

GET /venues/:venueId/production/:id odczytuje pojedynczą partię. Wyliczone
koszty są filtrowane przy odczycie i po replay według aktualnych praw.
EXECUTED jest terminalne: późniejsze odwrócenie partii zachowuje dowód jej
pierwotnego wykonania i nie otwiera tego samego szkicu do ponownej produkcji.

## Interfejs

Osobna akcja wykonania szkicu wybiera plan i czyści actualYield/lot.
Pola założeń są zablokowane; operator wpisuje zmierzony wynik i powód.
Pusty actualYield blokuje zatwierdzenie także w zwykłym formularzu produkcji.
Wynik0 pozostaje dozwolonym jawnym pomiarem według istniejącego kontraktu.
Do zmiany założeń należy wyjść z wykonywania i edytować szkic.

Timeout zachowuje dokładny payload/path/key. Powtórzenie rozpoznaje ten sam
wynik i pokazuje partię; po ponownym wejściu lista pokazuje EXECUTED oraz
przycisk odczytu partii przez batchId, bez ponownego POST. Zmiana konta/API
unieważnia stare odpowiedzi mutacji i stare wyniki odczytu partii.

## Weryfikacja i przegląd

TDD: najpierw brak endpointu. Podczas ekstrakcji wspólnego helpera testy
i tsc odtworzyły odwołanie do poprzedniego tx; poprawiono na przekazaną
transakcję store. Ponowny ukierunkowany przebieg API12/12 w4 plikach.
Przykład: plan3×4=12, actual10 → partia10, waste2, zużycie54000mg,
pozostało46000mg surowca i10 gotowych porcji.

Testy obejmują dokładne retry, terminalność, rollback przy braku składnika,
powtórne zatwierdzenia, cancel/execute, rewizję, strict payload, inny lokal,
role, odebranie praw i filtrowanie kosztów. Promise.all na PGlite nie jest
dowodem niezależnych połączeń PostgreSQL. UI10/10 w5 plikach: ręczny uzysk,
dokładne retry i odzyskanie powiązanej partii bez zapisywania produkcji.

Pełny web294/294 w69 plikach; shared57/57 w8 plikach. API TypeScript i web
build zaliczone. Znane ostrzeżenie wielkości pakietu pozostaje zakresem R07.
Spec i Standards: brak blokad. Drobne odziedziczone callbacki błędów mogą
pokazać stary komunikat przy podmianie API w tym samym scope; nie zapisują
danych ani nie wykonują operacji. Dane/mutacje chronione epoką żądania.

## Trwałość

Poprzednia pełna kopia: NIMBLE-DRAFT-EDIT-CANCEL-FULL-CODE.zip,
libfile_919823d8a1fc8191a2ceb1ca6f8efed3. Etap kończy nowa pełna kopia
źródeł i historii ze świeżym odtworzeniem. Nie obejmuje produkcyjnych danych
ani sekretów. Dalsze prace pieniężne nadal wymagają natywnej bramki01.

## Pełna regresja API
381/382 testów w76 plikach, wszystkie dokładnie raz, bez braków/duplikatów
i bez pending. Jedyny błąd: merchantNotificationPersistence.test.ts —
brak natywnego połączenia PostgreSQL. Przebieg pomocniczy PGlite obejmuje
kod a070159; później zmieniono tylko dokumentację statusu i wyników.
Ten wynik nie jest odbiorem natywnych blokad ani produkcyjnym wdrożeniem.
