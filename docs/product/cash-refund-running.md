# Pełny zwrot gotówkowy — kandydat zadania09

19.10.2026, baza5b40f54, gałąź recovery/production-drafts. Wycinek rozwojowy bez wdrożenia. Natywny PostgreSQL nadal blokuje odbiór01/07–09; poniższe testy PGlite nie dowodzą niezależnych sesji ani rzeczywistej wypłaty pieniędzy.

## Wynik
Kasjer z aktywnym kontem i własną otwartą zmianą zgłasza pełny, nieodwołalny wniosek z powodem1..500 znaków. Wniosek zatrzymuje wydanie (REFUND_PENDING), ale nie potwierdza oddania pieniędzy. Właściciel własnego lokalu może zgłosić i potwierdzić fizyczny zwrot również bez otwartej zmiany. CashHandedBack musi mieć literalną wartość true. Tylko REQUESTED przechodzi do CONFIRMED/REFUNDED.

V1 zwraca pełne dueMinor, nie banknot otrzymany od klienta. Nie ma częściowych zwrotów, anulowania wniosku ani pośredniego APPROVED. Nie odtwarza zapasu, wyceny zużycia ani kosztu produkcji. CASH V1 jest anonimowe i nie naliczało punktów; nie wywołano crypto refundLoyalty ani bramki blockchain.

## Dane, endpointy i bezpieczeństwo
Addytywna0044_cash_refunds.sql: osobny cashRefund z unikalnym orderId/receiptId, powodem, pierwotnym statusem, aktorem/czasem wniosku, właścicielem/czasem potwierdzenia, kwotą i walutą. PayoutShiftId zawsze null (także CHECK w bazie). Constrainty stanów, kwot i FK. Numer migracji wzięty z bieżącego journal43→44; zachowano styl ręcznych migracji0041–0043 bez nieprawdziwego snapshotu Drizzle. Świeża baza PGlite stosuje cały journal; natywny upgrade nadal do sprawdzenia.

- POST /v1/merchant/orders/:orderId/cash/refund/request {reason}
- POST /v1/merchant/orders/:orderId/cash/refund/confirm {refundId,cashHandedBack:true}
- GET /v1/merchant/orders/:orderId/cash/refund — aktualny autoryzowany stan dla odzyskiwania.

Mutacje wymagają Idempotency-Key. Scope obejmuje aktora, order i operację; istniejący merchantTaskRequest przechowuje hash i ID wyniku. Ten sam klucz z innym payloadem daje409. Ponowienie dla istniejącego zwrotu oddaje aktualny stan dokumentu i nie zmienia pierwszego powodu. Powtórzenie już zapisanego skutku może odzyskać wynik bez nowej zmiany; nowy wniosek kasjera wymaga otwartej zmiany. Każdy replay nadal wymaga aktualnego dostępu do lokalu.

Autoryzacja jest ponawiana wewnątrz transakcji, przed odczytem idempotencji. Sesja/pracownik/terminal kasjera są blokowane FOR SHARE. Request kasjera stosuje shift→order→refund, spójnie z close/status; owner confirm nie blokuje zmiany. Porównujemy receipt i immutable financialSale (CASH, receiptId, kwota, waluta, venue/order) przed mutacją. Status zamówienia, dokument, klucz i audit zatwierdzają się razem. Unikalne dokumenty i blokady order eliminują drugi skutek.

Publiczny checkout otrzymuje podsumowanie cashRefund i status, bez powodu ani aktorów. Autoryzowany panel odczytuje oryginalny powód. Obcy lokal daje404; kasjer nigdy nie potwierdza wypłaty.

## UI i odzyskiwanie
CashRefundBoard w panelu właściciela pozwala wybrać zamówienie gotówkowe, z pierwszeństwem oczekującego zwrotu. Kolejka kasjera ma rozwijane szczegóły bez masowych GET dla całej historii. Kasjer widzi wniosek; checkbox ostrzega o nieodwołalności i zatrzymaniu wydania. Właściciel musi zaznaczyć fizyczne oddanie pełnej kwoty.

Payload i klucz są zapisane przed POST w lokalnym intencie przypisanym do aktora/lokalu/order. Po timeout UI ostrzega, aby nie oddawać pieniędzy ponownie; wolno sprawdzić stan albo ponowić dokładnie ten zapis. Reload robi GET, nigdy automatyczne POST. Potwierdzony wynik wygrywa z błędem czyszczenia pamięci urządzenia. Uszkodzony zapis blokuje nową operację. Scope i epoch odrzucają spóźniony wynik poprzedniego konta/lokalu. Wszystkie nowe etykiety mają polskie tłumaczenia. Klient otrzymuje opis zwrotu gotówki zamiast twierdzenia o zwrocie crypto.

## Raporty i historia
CASH_REFUND_LIABILITY jest stanem CURRENT; REQUESTED nie odejmuje pieniędzy ani przychodu. CASH_REFUND_CONFIRMED jest zdarzeniem RANGE według confirmedAt, ma asset/network/hash/amountAtomic=null i payoutShiftId=null. Cash totals pokazują wpływy, potwierdzone zwroty, netto i bieżące zobowiązania; ownerCashPayouts stanowi osobną sekcję wypłat właściciela bez zmiany. CSV zachowuje kolumny i quoting, rozróżnia kind/paymentMethod/cashReceiptId.

Fiat odejmuje potwierdzony zwrot zapisanego financialSale, nie sam wniosek. Nieznany lub sprzeczny dokument sprzedaży nie daje domniemanego odwrócenia przychodu; przepływ gotówki pozostaje widoczny z ostrzeżeniem. Ekonomika produktu odejmuje zamrożony przychód, nie odwraca ilości sprzedanej ani kosztu zużycia. Crypto/netCashAtomic pozostają bez zmian.

DayClose ma jeden snapshot SQL obejmujący receipts, confirmed_at i aktualne REQUESTED. Wnioski są też w unresolved issues i przekazaniu zmiany. Fingerprint uwzględnia cash i ownerCashPayouts. Późniejsza wypłata jest osobnym zdarzeniem dnia i nie jest dopisywana do pierwotnej zmiany; stare reportSnapshot i DayClose pozostają niezmienne.

## Testy i odbiór
Ustalona granica testów: publiczne API i komponenty UI wskazane przez ticket; kontrolne przykłady1250/2000/750 oraz1250−1250=0. Red przed green: brak endpointu, brak zobowiązania w raporcie, brak komponentu. Timestamps dawnych faktów są ustawiane jako fixture do testu historii; asercje wyniku przez API.
Ukierunkowane API PGlite22/22 w5 plikach: cash-refund6, cash-report4, finance4, finance-ledger6, day-close2. UI cash-refund4/4: cashier request/exact retry, owner checkbox i reload po utracie odpowiedzi, zmiana konta/lokalu, uszkodzony intent. Pełne web306/306 w72 plikach; shared58/58 w9 plikach. API tsc i web build zaliczone; znane ostrzeżenie JS >500kB nadal R07.
Pełne API PGlite w5 shardach:400/401 w79 plikach. Jedyny błąd merchantNotificationPersistence.test.ts wymaga natywnego PostgreSQL; wynik w cash-refund-validation.json.
Runner natywnego PostgreSQL FAIL przed testami: brak NATIVE_POSTGRES_BIN / NATIVE_POSTGRES_TEST_URL. Nie obchodzono osłon runnera. Równoległe potwierdzenia i request kontra pickup w PGlite są regresją, nie zamknięciem kryterium „na różnych połączeniach PG”.

## Spec — przegląd niezależny
Brak konkretnego błędu implementacji. Luka dowodowa (obcy lokal, cofnięty dostęp, zamknięta zmiana, zmieniony payload i późniejsza wypłata) została uzupełniona. Ponowna kontrola potwierdziła, że pozostaje natywny PG.

## Standards — przegląd niezależny
Brak uwag wymagających zmiany. Po integracji UI/raportów oraz dodaniu guardu financialSale ponowny przegląd nie znalazł nowego problemu. Prawa właściciela, scope, dokładne kwoty i niezmienność historii zachowane.

## Następne i kopia
Zadanie10: pełny dzień lokalu w przeglądarce, osobne konteksty i rzeczywiste API/natywna baza. Zależności02/05/09 nie mają jeszcze natywnego odbioru; nie udawaj zaliczonego E2E.
Pełny checkpoint etapu: NIMBLE-CASH-REFUND-FULL-CODE.zip, po czystym commicie i świeżym odtworzeniu. Poprzednia kopia zachowana: NIMBLE-CASH-REPORT-FULL-CODE.zip, libfile_a02974243194819184448a5ad8f631f4, SHA2562a8f0b9e88818764cbb5d3a52c86b9cae0c1ffd862dc2198a2490c11ab7e65df. To kopie kodu i historii Git, nie produkcyjnej bazy i mediów.
