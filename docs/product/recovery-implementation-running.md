# Realizacja audytu R01–R03

2026-10-18. Baza: 823bb3b4baff453258e32709b6030cc74945bb5f.
Gałąź robocza recovery/r01-r03. Agent odpowiada za kopie całego kodu;
użytkownik nie wykonuje pushów i nie przechowuje lokalnego repozytorium.

## Zabezpieczenie kodu (R01)

Przed zmianami zapisano NIMBLE-FULL-CODE-823bb3b.zip, zawierający pełne źródła
i kompletną osiągalną historię Git. Potwierdzony trwały plik:
libfile_e516422f52748191886072a7547b09ae, /nimble/NIMBLE-FULL-CODE-823bb3b.zip.
SHA256 archiwum: 7dbc63e87f806d4c30559675aaa26ea8c8587132b024064b0b84f2f37e97899b.
Drzewo: ab742782388a7e23fdf600801f3cb325ff1eec95. Bundle zweryfikowano,
odtworzono świeży klon i wykonano git fsck --full bez błędów.

Dodano scripts/checkpoint-code.py oraz deploy/RECOVERY-PL.md. Każdy nowy
checkpoint musi zostać przesłany i potwierdzony przed kolejnym etapem.
Archiwa kodu nie zawierają danych produkcyjnych ani sekretów.
Nie traktujemy utworzenia ZIP albo commitu na dysku jako trwałego zabezpieczenia.
Publikacja nowych commitów na GitHub nie została wykonana; prywatny pełny
checkpoint jest niezależną drogą zachowania źródeł, nie deklaracją pusha.

## Bezpieczeństwo kopii danych (R02)

Odtworzono błąd: awaria pg_dump kończyła skrypt wynikiem 0, po czym bezwarunkowa
retencja mogła usuwać ostatnie starsze kopie. Test skryptu przeszedł od czerwonego
do zielonego po naprawie.

Nowy backup obejmuje DB i oba wolumeny zdjęć, prywatne pliki, manifest i sumy,
blokadę równoległych uruchomień, publikację dopiero pełnego kompletu oraz retencję
osobno dla udanego stosu. Nie usuwa starych płaskich dumpów SQL. Zwraca błąd po
awarii lub braku konfiguracji. Dla spójności krótko zatrzymuje app i workery,
próbując wznowić wcześniej działającą app także po błędzie; opisano ten wymóg
utrzymaniowy i granice gwarancji w instrukcji. Nie uruchomiono na serwerze.

Testy adaptera Docker i prawdziwych gzip/tar/sha256sum: 7/7. Obejmują dump fail,
media fail, restart fail, częściowy sukces, brak konfiguracji, zachowanie wyłączonej
app oraz dokładną zawartość kopii i izolację retencji. To nie jest jeszcze odbiór
rzeczywistego Docker/PostgreSQL ani odtworzenie danych — R08 pozostaje otwarte.

## Środowisko i R03

Runner guards: 2/2. Próba oryginalnego testu API nie dotarła do asercji:
ECONNREFUSED localhost:5433. Lokalnie brak Docker/PostgreSQL, a mapa UID kontenera
obejmuje tylko root. Nie deklarujemy natywnego odbioru ani pełnej regresji API.
Odtwarzamy zależności wersją pnpm 9.15.0 wskazaną przez projekt.

Po R01/R02 zapisano pełny checkpoint e546ed41e705643ffa1a15ebb26e044ebc5fe9e6:
libfile_973d84256388819195ac34045d0159f1, /nimble/NIMBLE-FULL-CODE-R01-R02.zip.
SHA256: b0f0bdea320c2e64b620ddfbb9e03bc4420a18195410dd461b85cdb4a07b1cb3.
Manifest obejmuje repozytorium, gałąź, pełny SHA/drzewo, wykaz migracji, środowisko
checkpointu i odniesienie do wyników oraz otwartych bramek. Od tego momentu origin
wskazuje konieczkocoin/nimble-pos, a poprzedni remote nazywa się published-baseline.

## Zrealizowana implementacja R03 — odbiór natywny nadal otwarty

Odtworzono na pomocniczym PGlite dawny błąd raportu: fixture bez trwałych dowodów
sprzedaży dawała 0/0/0 zamiast 1200/1200/900. Zastąpiono ją rzeczywistym przepływem
API: publikacja lokalu, remote, płatność, dwie akceptacje, jedna odmowa, zwrot
wpłaty bez sprzedaży i powtórzenia decyzji/zwrotu. Historyczne daty i dryf bieżącego
wiersza są celowo wstrzykiwane po rzeczywistym zapisie sprzedaży.

Ręczny wynik: zaakceptowane 500 + 700 = 1200 minor; odrzucone 900 nie jest sprzedażą,
więc jego zwrot nie odejmuje fiat od przychodu. NIM atomic:
1000 + 2000 + 3000 - 2000 = 4000. Okno operacyjne obejmuje tylko bieżące zdarzenia,
nie datę utworzenia zamówienia.

Potwierdzono też rzeczywistą rozbieżność dashboardu: po przyjętej sprzedaży 900
i późniejszej decyzji o zwrocie pokazywał 0. Nowe asercje najpierw odtworzyły błąd.
Dashboard sumuje teraz autorytatywne RECORDED merchantFinancialSale w oknie 24h,
także po zwrocie; to sprzedaż przyjęta, nie wynik netto. Raport nadal pokazuje
zwrot 900 i netto 0. Dokumentacja PL-20 wyjaśnia znaczenie metryki.

Workflow obejmuje teraz feat/nimble-pos i recovery/**; dodano kontrolę backupu.
Nie wykonano nowego pusha ani zdalnego przebiegu CI dla tych zmian.

Dodano jawnie pomocniczy, zapisany w repozytorium adapter PGlite 0.3.14 (dev-only,
wersja i integralność w lockfile), aby odtworzenie wyników finansowych nie zależało
od utraconych plików tymczasowych. Instalacja pnpm 9.15.0 z frozen-lockfile przeszła.
Adapter wykonuje aktualne migracje i normalizuje wynik execute do formatu
postgres-js; nie zmienia SQL ani oczekiwań testów. Domyślna konfiguracja i natywny
runner nadal używają PostgreSQL. PGlite nie potwierdza niezależnych sesji ani blokad.

Polecenia odtworzenia:

```bash
corepack pnpm install --frozen-lockfile
node --test scripts/test-backup.test.mjs scripts/test-native-postgres.test.mjs
corepack pnpm --filter @nimble/api test:finance:pglite
```

## Wyniki z tego etapu

| Sprawdzenie | Wynik | Granice |
|---|---|---|
| Pełny kod: bundle, świeży klon, HEAD/drzewo i fsck | Zaliczone dla checkpointów | Nie obejmuje danych produkcyjnych |
| Kontrole checkpointu | Zaliczone | CRC, odmowa nadpisania, brudnego drzewa i pliku wewnątrz repo |
| Backup + runner guards | 9/9 | Adapter Docker; bez rzeczywistego restore SQL |
| Finanse i dashboard przez API na PGlite | 8/8 | Kontrolowane adaptery płatnicze |
| Całe API na pomocniczym PGlite | 355/358; 67/69 plików | Niezaliczone, szczegóły poniżej |
| Web | 281/281; 63/63 plików | Testy interfejsu |
| Shared | 57/57; 8/8 plików | Kontrakty/logika wspólna |
| TypeScript API i web | Zaliczone | Bez zmiany kryteriów |
| Build web | Zaliczone | JS 809,42 kB, gzip 238,11 kB; pomiar/odchudzenie w R07 |
| PostgreSQL 16, niezależne sesje, pełne API na nim | Niewykonane | Brak serwera/Docker, root-only UID map |
| Przegląd Standards / Spec R01/R02/R03 | Brak usterek blokujących po poprawkach | Dwa oddzielne przeglądy, nie zastępują testów |

Pełne API na PGlite nie przeszło. Dwa przypadki w stock-reservations.test.ts:

- expires unsubmitted stock mathematically and refunds a late verified receipt without taking the next buyers hold;
- settles a previously untracked quote using its original decision and releases a newer sibling reservation.

W obu odpowiedź pozostała PAYMENT_PENDING. Ten sam cały plik uruchomiony na
odtworzonym bazowym 823bb3b z tym samym adapterem dał identyczne 2 błędy i 11
zaliczonych testów. To nie jest wykazana regresja zmian R03, ale nadal otwarty
problem do wyjaśnienia na natywnej bazie. Na tym etapie nie zmieniono tych testów ani oczekiwań. Aktualizacja diagnozy poniżej.

Trzeci przypadek, merchantNotificationPersistence.test.ts, używa bezpośrednio
postgres(url), poza helperem. Zakończył się ECONNREFUSED localhost:5433. Pozostawiono
go w pełnym przebiegu; nie wyłączono ani nie przerobiono natywnego odbioru.

## Dokładny następny krok

R03 ma wdrożoną i pomocniczo sprawdzoną naprawę, ale NIE jest odebrane: wymagany
jest pełny przebieg PostgreSQL 16 na końcowym, zabezpieczonym SHA, wraz z testami
niezależnych sesji i logiem. Otwarty wynik natywny nie pozwala przejść do zależnego
R04 jako gotowej podstawy. Kolejne uruchomienie zaczyna od odtworzenia najnowszego
pełnego archiwum, porównania SHA i rozwiązania tej bramki. PL-21 i dalsze funkcje
nie są oznaczone jako odzyskane lub wykonane. R08 (rzeczywisty restore i niezależna
kopia danych) i odbiór telefonu również pozostają otwarte.


## Kontynuacja R03 — spójny zegar testów rezerwacji

Baza tej kontynuacji: 98fd84d279a8de2728b1bad5c8977d634a7c1dea.
Pełny poprzedni checkpoint: libfile_d0034f6578c48191bb34be9212eb23dd,
NIMBLE-FULL-CODE-R01-R03.zip, SHA256
`d46fb4eafa0d127e9f6be55892c7176dc1e950e1ea2a6caa94aaef89ec8f745b`.

Odtworzono 2/13 błędów w całym stock-reservations.test.ts. Hipotezy:
częściowo przesunięty zegar, backoff weryfikacji, błędna rezerwacja zapasu.
Potwierdzono pierwszą: spy Date.now() przesuwał czas o 61 sekund, ale new Date()
pozostawał w rzeczywistym czasie. Przypadki korzystają z obu form czasu przy
zapisywaniu i sprawdzaniu terminów ponownej weryfikacji. Na pomocniczym PGlite
rozdzielenie zegarów powodowało pominięcie nowej próby płatności jako jeszcze
niewymagalnej. Samo przesunięcie całego Date usuwa oba błędy.

W dwóch przypadkach zastąpiono spy przez useFakeTimers({toFake:['Date']})
i setSystemTime; po każdym teście przywracany jest prawdziwy zegar.
Nie zmieniono oczekiwanych statusów, przepływu API ani kodu produkcyjnego.
Przebieg czerwony: 11/13; po poprawce: 13/13 (5,74 s).
Polecenie: corepack pnpm --filter @nimble/api exec vitest run
--config vitest.pglite.config.ts test/stock-reservations.test.ts.
TypeScript API zaliczony; zabezpieczenia runnera natywnego 2/2.

Pełny przebieg pomocniczy: 357/358, 68/69 plików, 152,27 s. Jedyny błąd:
merchantNotificationPersistence.test.ts — ECONNREFUSED, ponieważ używa natywnego
połączenia PostgreSQL. Oba poprzednie błędy rezerwacji zniknęły w pełnym przebiegu.
Nie wykluczono żadnego testu. Polecenie: corepack pnpm --filter @nimble/api exec
vitest run --config vitest.pglite.config.ts. Pełny przebieg nadal nie jest zielony.
Natywny PostgreSQL 16 pozostaje wymaganym odbiorem R03. Ponownie sprawdzono:
brak postgres/psql/docker, mapa UID tylko 0→0 (1 UID). Nie obchodzono ograniczeń
uruchamiania serwera jako root ani nie podmieniono natywnego helpera.
R04 nadal zależy od tego odbioru. Gotowy workflow native-postgres.yml wymaga
udostępnienia końcowego commitu runnerowi CI; obecna kopia prywatna nie jest
publikacją commitu na GitHub. Test trwałości powiadomień wymaga tego serwera.

## R04 — oddzielny kandydat rozwojowy

Po checkpointcie 0ba2d8b zapisanym w NIMBLE-FULL-CODE-R03-CLOCK.zip
(libfile_8b1756b498a88191be6ae4e9ce044800) utworzono gałąź
recovery/r04-cost-history. Zmieniono kolejność przygotowania, nie odbioru:
pierwszy fragment R04 powstaje oddzielnie podczas blokady środowiska R03.
Warunek natywnego odbioru R03 przed scaleniem i odbiorem R04 pozostaje.
Zakres, ograniczenia i testy: docs/product/r04-cost-history-running.md.
Wdrożono dokładne historyczne wyceny nowych fizycznych ruchów zapasów
oraz prywatny odczyt historii przez API. Raporty produktów/marży i UI nadal
nie są zaimplementowane. Dwa przeglądy nie znalazły dalszych blokujących
usterek po poprawkach pochodzenia waluty. Produkcja nie była aktualizowana.

Końcowa regresja kandydata R04 w pięciu rozłącznych częściach:
363/364 testów, 69/70 plików; pozostał natywny test powiadomień z
ECONNREFUSED. API i web tsc zaliczone. Pełny zakres i polecenia w raporcie R04.
Aktualny wynik nie zamyka bramki PostgreSQL 16 ani całego R04.


## Raport produktów i grup R04

Kolejna część R04 (baza 44112c0): jawne powiązania rozchodu ze sprzedażą,
proporcjonalna dokładna alokacja rabatów/kosztów, zamrożone kategorie,
zwroty bez przywracania składników, osobne straty/korekty oraz ekran
właściciela z polskimi opisami i dostępnymi na telefonie szczegółami.
Pełny kontrakt i wyniki: docs/product/r04-ingredient-margin-running.md.
Regresja JSON całego API: 367/368, wszystkie 71 plików bez pominięć;
jedyny błąd dotyczy natywnego połączenia powiadomień. Web 284/284,
shared 57/57; TypeScript i build zaliczone. Spec/Standards bez usterek
blokujących po poprawkach. Natywne R03/R04 nadal NIE jest odebrane.
Poprzedni pełny checkpoint 44112c0:
libfile_dfddb7e7b4e8819194fd5fe02b944c61, NIMBLE-FULL-CODE-R04-COST-HISTORY.zip,
SHA256 6fe3ee77052023d4f67487b450c02d76ade07e88e94b8418eeba01209ff72037.


## R05 — podpowiedzi zakupowe z historii

Baza 13279b0; osobna gałąź recovery/r05-history-purchases, bez znoszenia
zależności odbioru od natywnego R03/R04. Wdrożono zakupowy fragment R05:
pełne dni UTC, jawna próbka i progi historii, zużycie i zwroty produkcji,
straty jako osobna opcja, aktualne rezerwacje/straty oczekujące/dostawy,
wzór i edytowalny szkic, bez automatycznego zamawiania.
Kontrakt: docs/product/r05-history-purchases-running.md.
Regresja JSON: API 370/371, wszystkie 72 pliki, bez pominięć; jedyny błąd
wymaga natywnego PostgreSQL. Web 286/286, shared 57/57; TypeScript i build
zaliczone. Spec i Standards bez usterek blokujących.
Rekomendacje produkcji oraz natywny odbiór nadal pozostają otwarte.
Poprzednia pełna kopia kodu 13279b0:
NIMBLE-FULL-CODE-R04-INGREDIENT-MARGIN.zip,
libfile_3efff5791bc081919eccdf2cd5be6520,
SHA256 87b8f8dc961304062566dc36436e5f3f8053c1ed7fc8d5ab444cdd0f72a15538.

## R05 — podgląd propozycji produkcji

Baza d13d376, gałąź recovery/r05-production-proposals. Wyliczanie partii
z historii i jawnego oczekiwanego uzysku, składniki według wersji receptury,
aktualne rezerwacje/straty i pojemność produktu gotowego. Odczyt nie zmienia
zapasu. Kopiowanie do formularza usuwa faktyczny uzysk; operator wpisuje
zmierzony wynik i zatwierdza osobno. Osobny trwały szkic produkcji nie powstał.
Kontrakt: docs/product/r05-production-proposals-running.md.
API 373/374 w 73 plikach bez pominięć i duplikatów; jedyny błąd natywnego
PostgreSQL w merchantNotificationPersistence. Web 288/288, shared 57/57,
TypeScript i build zaliczone. Spec i Standards bez pozostałych blokad.
Natywne R03/R04/R05, telefon i niezależne sesje nadal pozostają otwarte.
Poprzednia pełna kopia kodu d13d3763ad3d48200e5facf29823bcbf595e1008:
NIMBLE-FULL-CODE-R05-HISTORY-PURCHASES.zip,
libfile_77b0e87713c08191b9ebddbd82d74ba9,
SHA256 1119eaaa36a2c3aea08acaca90bd682006d4bc3d214ece73cb9e164d971e9ad7.

## Kontynuacja — trwałe szkice produkcji03
Gałąź recovery/production-drafts, baza67ed431. Dodano osobny trwały typ
PRODUCTION_DRAFT w istniejącym JSONB, zapis/listę/odczyt, source UTC,
idempotencję i ekran otwierania planu z wyczyszczeniem actualYield.
Bez ruchów i rezerwacji; edycja/anulowanie/EXECUTED pozostają04–05.
Oddzielny kandydat podczas blokady01, bez scalania i bez natywnego odbioru.
API375/376 w74 plikach (jedyny błąd natywnego PG), web291/291,shared57/57,
API tsc/web build zaliczone. Spec i Standards bez blokad; dodatkowo
naprawiono późną odpowiedź zapisu po zmianie API i pokryto testem.
Szczegóły: docs/product/production-drafts-running.md.
Poprzednia pełna trwała kopia: NIMBLE-CASH-CONTRACT-FULL-CODE.zip,
libfile_ca5bc675f12081918cd471ef99217cb7.

## Kontynuacja04 — edycja i anulowanie szkiców
Baza041a1d2, gałąź recovery/production-drafts. Mutacje z oczekiwaną rewizją,
blokadą wiersza, idempotencją i audytem before/after. CANCELLED z aktorem,
czasem i powodem; brak ruchów zapasu. UI konflikt→odświeżenie→jawne przyjęcie
rewizji zachowuje formularz. Zmiany planu unieważniają propozycję wykonalności.
Spec po poprawce i Standards bez pozostałych blokad. Pełne API377/378
w75 plikach (jeden błąd natywnego PG), web292/292, shared57/57, tsc/build
zaliczone. Szczegóły: docs/product/production-draft-edit-running.md.
Wykonanie szkicu i powiązanie batchId pozostają05; natywny odbiór nadal otwarty.
Poprzednia pełna kopia: NIMBLE-PRODUCTION-DRAFTS-FULL-CODE.zip,
libfile_4b9053a9986881919db17632bb86d2ee.

## Kontynuacja05 — wykonanie szkicu produkcji
Baza8c8e641, recovery/production-drafts. Jedna transakcja tworzy partię
z ręcznym actualYield, ruchy i wycenę oraz szkic EXECUTED z batchId. Plan
pobierany ze szkicu pod blokadą i kontrolą rewizji; UI zachowuje dokładny
retry, a po wznowieniu odczytuje zapisaną partię bez ponownego POST.
Ukierunkowane API12/12 i UI10/10. Pełne API381/382 w76 plikach (jeden
znany błąd natywnego PG), web294/294,shared57/57,tsc/build zaliczone.
Spec/Standards bez blokad, natywna współbieżność nadal do odbioru.
Raport: docs/product/production-draft-execute-running.md.
Poprzednia trwała pełna kopia: NIMBLE-DRAFT-EDIT-CANCEL-FULL-CODE.zip,
libfile_919823d8a1fc8191a2ceb1ca6f8efed3.

## Kontynuacja07 — sprzedaż gotówkowa
Baza494d802. Kandydat obejmuje gotówkę w ekranie kasjera, dokładną resztę,
atomowy receipt/snapshot/stock/financialSale, trwały intent i odzyskiwanie
po utracie odpowiedzi. Chroni przed powtórną sprzedażą, historią płatności
portfelem, brakiem zapasu i sprzecznym snapshotem. Osobne przeglądy
Spec/Standards z poprawkami. Pełne wyniki i ograniczenia w
docs/product/cash-sale-running.md. Natywny PG nadal blokuje odbiór.
Raporty08 i zwroty09 pozostają kolejne; nie wdrożono kandydata.
Kopia: NIMBLE-CASH-SALE-FULL-CODE.zip, pełna historia i świeże odtworzenie.
Poprzednia: NIMBLE-DRAFT-EXECUTION-FULL-CODE.zip,
libfile_b0db38c37f6c8191b8f6ed9df63c2669.

Weryfikacja07: API PGlite390/391 w77 plikach (znany natywny błąd),
web300/300, shared58/58; API tsc i web build zaliczone.

## Kontynuacja08 — gotówka w raportach i zamknięciu dnia
Baza415faa3. Finance, CSV i raport zmiany rozdzielają CASH/CRYPTO; gotówka
liczy due po reszcie, crypto zachowuje atomic. DayClose używa czasu
sprzedaży, strefy i granicy dnia; cash i podział metod w jednym snapshot
SQL i fingerprint, stare zamknięcia nieprzeliczane. UI z polskimi etykietami.
Ukierunkowane API25/25, web302/302, shared58/58, tsc/build zaliczone.
Pełne API i szczegóły: docs/product/cash-report-validation.json oraz
cash-report-running.md. Osobne Spec i Standards po poprawkach bez uwag
blokujących. Natywny PostgreSQL nadal uniemożliwia odbiór01/07/08.
Kolejne09: zwroty gotówkowe; nie wykonano ich w08.
Kopia: NIMBLE-CASH-REPORT-FULL-CODE.zip z pełną historią i odtworzeniem.
Poprzednia zachowana: NIMBLE-CASH-SALE-FULL-CODE.zip,
libfile_3b21ec0e1bc48191a037fb86fe12832c.

Pełna regresja08: API PGlite394/395 w78 plikach (znany natywny błąd),
web302/302, shared58/58; API tsc i web build zaliczone.

## Kontynuacja09 — pełny zwrot gotówki
Baza5b40f54. Osobny dokument i migracja0044, request zatrzymujący pickup,
owner-only potwierdzenie fizycznej wypłaty. Pełna kwota receipt, bez
odtworzenia zapasu/kosztu/lojalności. Idempotencja, fresh auth i audit
w transakcji. UI zachowuje intent i odzyskuje wynik po timeout/reload.
Raporty rozdzielają REQUESTED liability i CONFIRMED payout. Wypłata
bez zmiany idzie do dnia confirmedAt, stare zmiany i zamknięcia bez zmian.
Ukierunkowane API22/22, web306/306, shared58/58, typy/build zaliczone.
Pełne wyniki i ograniczenia: cash-refund-running.md / cash-refund-validation.json.
Spec i Standards niezależnie bez otwartych uwag; natywny PG nadal blokuje
odbiór, nie wdrożono kandydata. Następne10 wymaga rzeczywistego E2E.
Kopia: NIMBLE-CASH-REFUND-FULL-CODE.zip. Poprzednia zachowana:
NIMBLE-CASH-REPORT-FULL-CODE.zip, libfile_a02974243194819184448a5ad8f631f4.

Pełna regresja09: API PGlite400/401 w79 plikach (znany natywny błąd),
web306/306, shared58/58; typy API i web build zaliczone.

2026-10-19: task10 — przygotowany izolowany scenariusz pełnego dnia, realne API i kontrolowana symulacja portfela/łańcucha. Guardy11/11 i typy PASS; discovery1, E2E0 wykonanych z powodu braku natywnej bazy testowej. Status blocked. Szczegóły full-day-running.md.

2026-10-19: task10 CI — .github/workflows/full-day.yml przygotowuje natywną bazę i Chromium w ręcznym jobie. Lokalnie nadal brak PostgreSQL i wyłącznie UID0; E2E0 wykonanych. YAML/shell PASS, guardy2/2, discovery1, niezależne przeglądy bez uwag. Brak push/uruchomienia Actions. Pełna kopia NIMBLE-FULL-DAY-CI-FULL-CODE.zip; szczegóły full-day-running.md.

2026-10-19: niezależna poprawka sesji terminala — spóźnione401 starego kasjera nie usuwa nowego logowania. Repro RED, testy initial/poll/current401, przeglądy Spec/Standards. Nie zamyka task10/11. Szczegóły session-poll-recovery-running.md i plik validation. Nowa pełna kopia NIMBLE-SESSION-RECOVERY-FULL-CODE.zip.

2026-10-19: izolacja cache terminala — nowy kasjer nie widzi poprzedniego raportu podczas ładowania. Test RED→GREEN5/5; wyniki pełnej walidacji session-cache-isolation-validation.json. Nie zamyka task10/11. Pełny checkpoint NIMBLE-SESSION-ISOLATION-FULL-CODE.zip.

2026-10-19: task01 — workflow zachowuje SHA checkoutu i wersje Node/pnpm
w jednym logu z wynikami API. Zmiana d17ac1c, YAML/bash PASS, cztery kontrole
potoku PASS, osłony/backup9/9 PASS. Spec i Standards niezależnie0 uwag.
Pełny natywny runner nadal zablokowany przed API (brak konfiguracji PG),
testy API0 wykonanych. Task01/PL-02 pozostają blocked. Szczegóły
native-postgres-evidence-running.md. Nowa pełna kopia docelowa:
NIMBLE-NATIVE-EVIDENCE-FULL-CODE.zip; wcześniejsze archiwa zachowane.

## Kontynuacja19.10.2026 — natywny odbiór01–09 i pipeline10

Usunięto blokadę środowiskową: dokładny snapshot a4285f8 opublikowano na
osobnej gałęzi recovery/native-acceptance-20261019 w konieczkocoin/nimble-pos.
Drzewo lokalne i zdalne e6dc1bf... zweryfikowano jako identyczne. Draft PR1
do feat/nimble-pos, bez scalenia/wdrożenia. Natywny run39246316523:
PostgreSQL16.15, PID84/85, API401/401 w79 plikach, fail0/skip0, w tym
merchantNotificationPersistence PASS. Dowody trwale w źródłach:
native-postgres-acceptance-20261019.json/.txt.

W tej kontynuacji UI kosztów/finansów7/7 i UI szkiców/gotówki18/18 PASS,
API tsc/web build PASS. Nowy test eeeceb9 sprawdza kwoty marży przed i po
zwrocie. Niezależne przeglądy oraz audyt kryteriów03–09 bez luk; macierz
acceptance-01-09-running.md. Zaktualizowano wyniki01–09 i historyczne blokady.

Pipeline8fc0d05 (zdalnie eb239cd) wywołuje istniejący full-day jako reusable
workflow dopiero po natywnym API i UI raportów. W run39246603442 pierwsza
bramka PASS; wynik pełnego dnia w full-day-running.md. Symulowany tylko
portfel/tożsamość/łańcuch; biznesowe API i baza rzeczywiste.

Pełny checkpoint docelowy: NIMBLE-NATIVE-ACCEPTANCE-FULL-CODE.zip;
poprzedni NIMBLE-NATIVE-EVIDENCE-FULL-CODE.zip,
libfile_820668cb19548191af651fc515837963,
SHA256dcbfb6cce7b4c7125fc488180355cbafc6adc925fd8a41512684cca998220045.
Nowe ID/hash potwierdzić w zewnętrznym raporcie po końcowym zapisie.

## Kontynuacja20.10.2026 — rzeczywisty deadlock i ponowny odbiór

Run39475756081 ujawnił natywny deadlock POS/remote/nagroda.
Test809791c odtwarza go deterministycznie przez barierę dostawcy remote;
run39476784632 RED. Poprawkaa89cbdb używa NO KEY UPDATE dla lokalu
przy wycenie remote: zachowuje serializację kolejki i umożliwia FK KEY SHARE
rezerwacji/ruchów magazynu. Spec/Standards bez uwag; API tsc PASS.
Run39477296697: focused1/1, API401/401 w79plikach, UI raportów7/7;
fail0/skip0. PG16.15, PID105/106, Node22.23.3, pnpm9.15.0.
Dowody native-postgres-acceptance-20261020.json/.txt oraz RED osobno.

Full-day tego samego run przechodzi gotówkę z odbiorem, ale wymaga
synchronizacji kontrolowanego checkboxa dostępności remote po odpowiedzi API.
Poprawkaf046f72 dodaje oczekiwanie na rzeczywisty PATCH oraz stan serwera/UI.
Typy E2E PASS, oba przeglądy bez uwag. Wynik następnego pełnego przebiegu
w full-day-running.md; nie oznaczaj10 jako completed przed GREEN.

Task10 odtworzył także rzeczywisty brak listy następców po odświeżeniu
zalogowanego terminala. afb68bb pobiera roster z osłonami sesji/lokalu/parowania;
regresja RED→GREEN, web314/314, targeted10/10, build PASS, przeglądy bez uwag.
Szczegóły terminal-roster-recovery-running.md. Bieżący browser retry pending.

## Końcowy odbiór20.10.2026 — task10 zaliczony

Run39480374937: focused native1/1, API401/401 w79plikach, raportyUI7/7,
pełny dzień1/1 ze wszystkimi10etapami; fail0/skip0/retry0/flaky0.
Checkoutd6d84601cb7d602c27f6b5f80af57b2f20c2b617 ma drzewo
bab9c3cbb541617632b47e9fa9d187c4f8296a64 identyczne z localafb68bb,
published5388dc58742f1b5fb939346c81f3582e7fec8a43. PG16.15, Node22.23.3,
pnpm9.15.0; native PID103/104. Browser job118828815672.
Web314/314 w72plikach, targeted10/10, build/typecheck PASS. Przeglądy
Spec/Standards bez otwartych uwag. Naprawiono rzeczywiste zakleszczenie PG
i brak rosteru przywróconej sesji; asercje finansowe zachowane.
Dowody full-day-acceptance-20261020.json/.txt i native-postgres-acceptance-final-20261020.txt.
01–10 zaliczone;11/12 ready-for-agent. Portfel/łańcuch symulowany: nie
jest to odbiór realnego przelewu, telefonu ani wdrożenia. PR1 nadal draft.
Końcowy commit dokumentacyjny nie zmienia testowanego kodu/testów/workflow.
Pełny checkpoint NIMBLE-NATIVE-ACCEPTANCE-FULL-CODE.zip zachowuje wszystkie
źródła i osiągalną historię; potwierdzone nowe ID/SHA256 w zewnętrznym
raporcie kontynuacji i opisie PR po zapisie. Wcześniejsze archiwa zachowane.
