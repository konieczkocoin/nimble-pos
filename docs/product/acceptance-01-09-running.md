# Odbiór zadań01–09 — 19.10.2026

Aktualny wynik zastępuje historyczne opisy blokady PostgreSQL. Implementacje
istniały wcześniej; ta kontynuacja uruchomiła natywny odbiór, uzupełniła
sprawdzenie widocznych kwot marży i umożliwiła wykonanie scenariusza10 w CI.
Nie oznacza wdrożenia ani testu urządzenia/rzeczywistego łańcucha.

## Natywna bramka01

Run https://github.com/konieczkocoin/nimble-pos/actions/runs/39246316523,
job118038991942:401/401 testów w79/79 plikach, fail0, skip0.
PostgreSQL16.15; dwa niezależne PID84/85; Node22.23.3; pnpm9.15.0.
Checkout97e69130273335512a95e8223e1a26b0654a0cc3 jest commitem merge PR.
Jego drzewo e6dc1bf544a72065c18076e5b3caeb8799256cca zweryfikowano
przez GitHub Git API jako identyczne z lokalnym a4285f8 i z opublikowanym
head4775493a3eccf91dc0cd74ad05119676cf42aa5f. Bez wykluczeń testów.
Lista79 plików i wszystkie401 linie PASS zachowane w plikach
native-postgres-acceptance-20261019.json/.txt; log również zawiera
merchantNotificationPersistence PASS. To wynik wykonania, a nie discovery.

## Macierz poprzedników10

| Zadanie | Natywne API | Aktualne UI | Dowód wartości / reguły |
|---|---|---|---|
| 02 | economics4/4, finance4/4 | economics4/4, finance3/3 | 900−100=800; po zwrocie0−100=−100; koszt null nie jest zerem |
| 03 | production-drafts2/2 | 3/3 | Plan3×4=12 trwale zapisany, bez ruchu zapasu; idempotencja i izolacja |
| 04 | production-draft-edit2/2 | 1/1 | Jedna edycja rewizji; anulowanie bez ruchu; ochrona starego zakresu |
| 05 | production-draft-execute4/4 | 2/2 | Plan12, pomiar10; jeden batch, rollback i cancel/execute |
| 06 | kontrakt, bez osobnego testu | nie dotyczy | Modele, stany, błędy, uprawnienia i reszta; sprawdzone wobec07–09 |
| 07 | cash-sale9/9 | 6/6 | Należność1250, wpłata2000, reszta750; równoległe retry daje jeden zapis |
| 08 | cash-report4/4 | 2/2 | CASH1250+CRYPTO750=2000; atomic osobno, CSV i cutoff |
| 09 | cash-refund6/6 | 4/4 | Sprzedaż1250−zwrot1250=0; zapas nie rośnie; tylko owner confirm |

API obejmuje również inne pliki wspierające te moduły; tabela wymienia ich
główne scenariusze. UI02:7/7 i UI03–09:18/18 wykonano lokalnie w tej
kontynuacji. Test02 widocznych9.00/1.00/8.00 i0.00/1.00/−1.00 EUR dodano
w eeeceb9; nie był częścią wcześniejszego natywnego runu. Kod API i UI
aplikacji pozostaje taki sam jak w zaliczonym runie; zmieniły się testy,
workflow i dokumentacja. API typecheck i web build PASS. Znane ostrzeżenie
pakietu869.85kB (254.80kB gzip) pozostaje zakresem13.

Niezależne przeglądy Spec/Standards nowej zmiany i dodatkowy audyt kryteriów
03–09 nie wykazały blokujących braków. Wcześniejsze przeglądy implementacji
zachowano w raportach modułów. Zależności zamknięto kolejno przed odbiorem10.

## CI i przekazanie

Draft PR https://github.com/konieczkocoin/nimble-pos/pull/1 kieruje gałąź
recovery/native-acceptance-20261019 do feat/nimble-pos; żadna gałąź wydania
nie została scalona. Zmiana8fc0d05 (zdalny odpowiednik eb239cd) dodaje
wywołanie istniejącego full-day jako reusable workflow po zielonym natywnym
API i ekranach raportów. Automatyczny full-day tylko dla PR, nadal dostępny
ręcznie. Oddzielna świeża baza, symulowane wyłącznie tożsamość/portfel/łańcuch.
Wynik10 jest zapisywany osobno w full-day-running.md po faktycznym wykonaniu.

Pełna poprzednia kopia: NIMBLE-NATIVE-EVIDENCE-FULL-CODE.zip,
libfile_820668cb19548191af651fc515837963,
SHA256dcbfb6cce7b4c7125fc488180355cbafc6adc925fd8a41512684cca998220045.
Nowy checkpoint docelowy: NIMBLE-NATIVE-ACCEPTANCE-FULL-CODE.zip; pełna
historia i świeże odtworzenie wymagane przez scripts/checkpoint-code.py.
Potwierdzone ID i SHA256 pozostają w zewnętrznym raporcie po zapisie.
