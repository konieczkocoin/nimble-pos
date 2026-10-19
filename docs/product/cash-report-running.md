# Gotówka w raportach — kandydat zadania08

19.10.2026. Baza415faa3, gałąź recovery/production-drafts. Izolowany kandydat rozwojowy, bez wdrożenia. Odbiór01/07/08 na natywnym PostgreSQL pozostaje otwarty; PGlite nie zastępuje niezależnych sesji PG.

## Wynik i źródło prawdy
Dla anonimowej sprzedaży gotówkowej1250 (banknot2000, reszta750) oraz NIM o cenie fiat750 raport pokazuje sprzedaż2000, wpływ gotówkowy1250, osobno atomic NIM. Receipt nie jest ponowną sprzedażą. Zsumowanie wszystkich rodzajów wpisów ledger nie jest obrotem — SALE i CASH_PAYMENT opisują różne fakty.

FinanceReport dodaje cash[] (currency, receivedMinor, confirmedRefundsMinor, netMinor, refundLiabilityMinor), salesByPaymentMethod[] (currency, paymentMethod, salesMinor, count) oraz CASH_PAYMENT w ledger. Wpisy mają paymentMethod i cashReceiptId; CASH_PAYMENT ma asset/network/hash/amountAtomic=null. Gotówka używa dueMinor, nie tenderedMinor. Wszystkie sumy są bigint/string lub SQL sum(bigint). Limit5000 i repeatable-read pozostają.

Cash[] jest puste dla zakresu bez potwierdzeń gotówkowych. Nie fabrykujemy historii gotówki. Legacy crypto jest klasyfikowane po zachowanym paymentHash; bez dowodu metoda pozostaje null/Unknown. CSV dopisuje payment_method i cash_receipt_id na końcu, zachowując stare kolumny, escaping i ochronę csvCell.

Raport kasjera/zmiany pokazuje osobne cash i salesByPaymentMethod. Sumy sprzedaży używają immutable financialSale, bez joinu receipt×movements. Istniejąca ekonomika produktu już czyta ten sam dokument; test potwierdza przychód1250 i ilość1 dla gotówki. Nie dodano drugiego konkurencyjnego raportu produktów.

## Dzień operacyjny i historia
Dzień jest liczony według zapisanego czasu sprzedaży occurred_at oraz wybranej strefy/boundaryHour, zgodnie z istniejącym interfejsem. Tworzenie koszyka kilka dni wcześniej nie przenosi dzisiejszej sprzedaży do przeszłości. Nowy financialSale CASH otrzymuje dokładnie receipt.recordedAt jako occurredAt. Finance zachowuje jawny zakres UTC, bez ukrytej zmiany jego znaczenia.

DayClose capture nadal jest jednym zapytaniem SQL, więc cash i sprzedaż widzą ten sam snapshot. Dodane salesByPaymentMethod i cash uczestniczą w fingerprint. Zapisany cutoff ani reportSnapshot zamkniętej zmiany nie jest przeliczany po późniejszych zdarzeniach. Starsze snapshoty bez podziału zachowują oryginalne dane i UI wyjaśnia jego brak.

UI pokazuje metody i ruchy gotówki w FinanceBoard, MerchantReport, preview i historii DayCloseBoard. Odróżnia zapisane ruchy od przeliczonego fizycznie stanu kasy. Kwoty formatuje przez bigint, wspólnie z ekonomią produktu. Nowe etykiety mają polskie tłumaczenia.

## Weryfikacja i red/green
Publiczne granice testów wybrane przez ticket: API finance/day-close/shift-report/economics, komponenty FinanceBoard/DayCloseBoard i eksportowany CSV. Testy powstały przed odpowiednimi zmianami: brak cash w raporcie, brak przypisania starego koszyka do dnia sprzedaży i brak sekcji UI odtworzyły czerwone przypadki.

Ukierunkowane API PGlite:25/25 w5 plikach: cash-report4, cash-sale9, finance4, finance-ledger6, day-close2. Nowe przypadki: mixedcash/crypto i retry bez dublowania; cena po rabacie; 19-cyfrowa kwota atomic; stare createdAt; zachowanie zamknięcia; produkt/zmiana; obcy właściciel i kasjer; pusta historia; Europe/Warsaw boundary4 przy zmianie czasu (2026-03-29T01:59:59Z oraz02:00:00Z trafiają do różnych dni).
Pełne web302/302 w71 plikach, shared58/58 w9 plikach. UI cash-report2/2 zawiera odczyt zawartości wygenerowanego CSV.
API tsc --noEmit i web build zaliczone. Ostrzeżenie dużego pakietu JS nadal należy do R07.
Pełne API PGlite w5 shardach:394/395 w78 plikach. Jedyny błąd merchantNotificationPersistence.test.ts nadal wymaga natywnego PG. Wynik zapisany w cash-report-validation.json.
Natywny runner FAIL przed testami: brak NATIVE_POSTGRES_BIN i NATIVE_POSTGRES_TEST_URL. Nie pominięto tej bramki ani nie ogłoszono produkcyjnego odbioru.

## Spec — niezależny przegląd
Brak potwierdzonego błędu funkcjonalnego. Wskazana luka dowodowa dotycząca strefy/boundary i obcego lokalu została uzupełniona; ponowny przegląd potwierdził jej zamknięcie. Pozostaje natywny PostgreSQL.

## Standards — niezależny przegląd
Brak uwag blokujących. Wskazano brak polskich etykiet; dodano tłumaczenia i potwierdzono je w ponownej kontroli. CASH/CRYPTO pozostają spójnymi kodami domenowymi również w CSV. Nie uznano refaktoryzacji za konieczną dla tego zakresu.

Przeglądy: Spec0 otwartych uwag funkcjonalnych; Standards0 otwartych uwag. Oba zachowują ograniczenie natywnego odbioru.

## Następny krok i kopia
09: zwroty gotówkowe, osobna wypłata i powiązanie z jej zmianą/dniem; dopiero wtedy agregacja CASH_REFUND_CONFIRMED/CASH_REFUND_LIABILITY. Tutaj pola zwrotów są zerowe wyłącznie dla walut posiadających receipt, ponieważ ścieżka wypłaty nie jest jeszcze wdrożona. Nie twórz pozornej wypłaty ani nie zmieniaj netCashAtomic na gotówkę.

Pełny checkpoint tego etapu: NIMBLE-CASH-REPORT-FULL-CODE.zip; tworzenie po czystym commicie, weryfikacja świeżego klonu i fsck, następnie trwały zapis. Nie zawiera danych produkcyjnej bazy, mediów i sekretów. Poprzednia pełna kopia zachowana: NIMBLE-CASH-SALE-FULL-CODE.zip, libfile_3b21ec0e1bc48191a037fb86fe12832c.

## Aktualny odbiór — 19.10.2026

API test/cash-report.test.ts: 4/4 PASS w pełnym natywnym run39246316523 (PostgreSQL16.15, pełne API401/401). UI test/cash-report.test.tsx: 2/2 PASS w aktualnym lokalnym przebiegu18/18 dla03–09.
Niezależny audyt Spec nie znalazł luk w kryteriach ticketu. Poprzednie
opisy otwartej bramki PostgreSQL są historyczne; aktualne dowody:
native-postgres-acceptance-20261019.json/.txt i acceptance-01-09-running.md.
Brak wdrożenia i odbioru fizycznego telefonu w tym etapie.
