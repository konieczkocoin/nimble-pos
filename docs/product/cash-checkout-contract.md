# Gotówka — kontrakt implementacji zadań07–09

18.10.2026. Zadanie06. Status: kontrakt przejrzany w osiach Spec i Standards; uwagi uwzględniono.
To decyzje do implementacji; endpointy i tabele poniżej jeszcze nie istnieją.
Projekt kontraktu jest niezależny od uruchomienia PG. Odbiór i integracja kodu
sprzedaży pozostają zależne od zadania01. Zmieniono wyłącznie kolejność
przygotowania dokumentacji; nie zaliczono natywnej bramki.

## Zakres V1

COUNTER, jedna metoda na całą sprzedaż, waluta fiat utrwalona w zamówieniu
zgodna z walutą lokalu w chwili potwierdzenia. Bez kursu crypto i bez napiwku.
REMOTE, sprzedaż nagrody lojalnościowej za gotówkę i mieszane metody poza V1.
MerchantAsset pozostaje NIM|USDT. Nowe MerchantPaymentMethod=CASH|CRYPTO.
Istniejące MerchantPayment i MerchantQuote pozostają kontraktami crypto.
Order.payment nadal jest wyłącznie potwierdzeniem crypto; gotówka ma osobne
cashReceipt. Widoki muszą sprawdzać metodę, a nie zakładać że payment!=null
jest jedyną możliwością opłacenia zamówienia.

## Model danych i migracja expand

1. merchant_order: nullable payment_method, cash_receipt_id FK nullable.
   Odczyt dawnych zamówień: null oznacza dotychczasowy CRYPTO, bez masowego
   przepisywania dokumentów. Utrwalona metoda niezmienna po zapłacie.
2. merchant_cash_receipt: id UUID, order_id UNIQUE FK, venue_id FK,
   shift_id FK, employee_id FK, currency EUR|PLN|USD, due_minor integer,
   tendered_minor integer, change_minor integer, order_revision integer,
   paid_snapshot JSON zgodny z MerchantPaidSnapshot, recorded_at timestamptz.
   CHECK due>=0, tendered>=due, change=tendered-due; wszystkie <=2147483647.
   Referencje lokalu/zmiany/order muszą być zgodne; sprawdza transakcja.
3. merchantFinancialSale zostaje jednoznaczne per orderId. Rozszerz typ
   FinancialSaleSnapshot addytywnie o paymentMethod?,cashReceiptId?;
   paymentHash staje się string|null. Dawne string pozostają poprawne.
   Gotówka: paymentMethod=CASH,paymentHash=null,cashReceiptId ustawiony.
   provenance=LIVE_ACCEPTANCE,timeBasis=SERVER_ACCEPTANCE,status=RECORDED.
4. Osobna merchant_cash_refund: id, order_id UNIQUE, receipt_id UNIQUE,
   venue_id, status REQUESTED|CONFIRMED, reason, requested_by_kind/id/name,
   requested_at, confirmed_by_owner_id, confirmed_at, amount_minor,currency.
   Kwota pełnego zwrotu równa due_minor, nie tendered_minor.
   Powody1..500 znaków; czas i aktor wyłącznie z serwera.

Nie dodawaj sztucznych hash/network/sender do gotówki. Nie zmieniaj
merchantVerifiedTransaction ani łańcuchowych claimów. Migrację wygeneruj
zgodnie z bieżącym dziennikiem drizzle, bez ręcznego zgadywania numeru.

## API i autoryzacja

Namespace istniejący /v1/merchant. Wszystkie operacje wymagają
Idempotency-Key zgodnego z istniejącą polityką. Request strict, JSON
integer minor units0..2147483647, UUID tam gdzie wskazany.

POST /v1/merchant/orders/:orderId/cash/confirm
```
{revision: integer>=1, tenderedMinor: integer>=0}
```
Serwer wylicza due z niezmienionego zamówienia i uzgodnionego rabatu,
ignoruje wszelkie przesłane total/amount/currency/change (strict:400).
Response200: {order:MerchantOrder,cashReceipt:{id,orderId,currency,
dueMinor,tenderedMinor,changeMinor,recordedAt}}. GET istniejącego order
zwraca metodę i receipt z autoryzacją jak obecnie. Publiczny checkout
widzi metodę, należność i status, ale nie tenderedMinor/changeMinor ani aktora.

POST /v1/merchant/orders/:orderId/cash/refund/request
```
{reason: string1..500}
```
Response200: {id,orderId,status:REQUESTED|CONFIRMED,amountMinor,currency,
requestedAt,confirmedAt:null|string}. Powtórzenie dla tego samego rachunku
nie tworzy drugiego wniosku i nie zmienia pierwotnego powodu.

POST /v1/merchant/orders/:orderId/cash/refund/confirm
```
{refundId: UUID, cashHandedBack: true}
```
Właściciel potwierdza rzeczywiste oddanie gotówki; false/missing=400.
Response200 ten sam obiekt zwrotu ze statusem CONFIRMED i czasem serwera.
Nie ma pośredniego APPROVED sugerującego że gotówka już została wypłacona.

| Operacja | Kasjer/kierownik | Właściciel | Publiczny klient |
|---|---|---|---|
| Sprzedaż CASH | Aktywne konto na przypisanym terminalu, własna otwarta zmiana i zamówienie tej zmiany | Nie sprzedaje przez owner-session; może zalogować się jako uprawniony pracownik | Nie |
| Wniosek o zwrot | Aktywne konto w tym lokalu; własna otwarta zmiana, order może pochodzić ze starszej zmiany | Tak, w swoim lokalu | Nie |
| Potwierdzenie zwrotu | Nie, także inventory.manage nie wystarcza | Tak, w swoim lokalu, otwarta zmiana niewymagana | Nie |
| Raport i koszty | Dotychczasowe reports.view/inventory.costs | Tak | Nie |

Uprawnienia i aktywność odczytaj ponownie wewnątrz transakcji mutacji.
Zasób obcego lokalu/order niedostępnego aktorowi daje404, nie ujawnia istnienia.

## Transakcja sprzedaży i wyścigi

1. Idempotencja: scope zawiera aktora/order/operację. Ten sam klucz+payload
   odtwarza200; inny payload409 IDEMPOTENCY_CONFLICT. Powtórzenie nadal wymaga
   bieżącego dostępu, także przy gotowej zapisanej odpowiedzi.
2. Zablokuj order FOR UPDATE, potem shift FOR UPDATE; porównaj revision,
   source COUNTER, status AWAITING_PAYMENT, brak payment/cashReceipt oraz
   brak pendingPaymentHash i jakiegokolwiek merchantTransferAttempt PAYMENT.
   Każda istniejąca próba crypto blokuje CASH, nawet bez potwierdzenia:
   najpierw rozstrzygnąć ją lub anulować stare zamówienie zgodnie z istniejącym
   bezpiecznym przepływem; nigdy nie zmieniaj metody niepewnej wpłaty.
3. Wymagaj braku wydanej wyceny quote/quoteHistory dla CASH V1. UI przed
   wyborem metody nie wydaje wyceny crypto. Powrót z kroku podpisu nie
   odblokowuje gotówki na starym order. Rabat i inne zmiany koszyka zwiększają
   revision. Druga równoległa płatność/revision daje409 bez kolejnego rozchodu.
4. Sprawdź stan i zużyj zapas atomowo według zamrożonych wymagań. Refaktor
   stockReservations powinien przyjąć jawne źródło CASH_RECEIPT z ID zamiast
   udawać quoteId. Dostępne=physical minus cudze rezerwacje minus pendingLoss;
   zablokuj zasoby w porządku ID takim samym jak obecna ścieżka crypto.
   Nie twórz bezterminowej rezerwacji; potwierdzenie w tej transakcji od razu
   zużywa zapas. Brak dostępności409 STOCK_UNAVAILABLE, wszystko rollback.
5. Utwórz cashReceipt i paidSnapshot, order.paymentMethod=CASH,
   status PREPARING, usuń możliwość edycji koszyka; increment revision.
   Utrwal merchantFinancialSale oraz wyceny rozchodu z orderId. Jedna
   transakcja obejmuje receipt, ruchy, finanse i stan zamówienia.
6. Gotówka V1 anonimowa: payerUserId=null i brak earnLoyalty. Jeżeli order
   ma już powiązanie payerUserId, rewardRedemption lub publiczne claimSessionId,
   odrzuć CASH_CUSTOMER_LINK_UNSUPPORTED. Obsługa identyfikowanego klienta
   wymaga późniejszego jawnego ticketu tożsamości; nie dopisuj punktów
   portfelowi kasjera/właściciela. Istniejąca lojalność crypto bez zmian.
7. Zwolnienie blokad i commit przed odpowiedzią. Nie zmieniaj quote/rate;
   żadnych wywołań provider/RPC przy gotówce. Zdarzenia UI po commit.

Kolejność blokad musi zostać porównana z zamknięciem zmiany i rabatami
przed implementacją. Jeśli obecne funkcje blokują inaczej, ujednolić je
w najmniejszym wspólnym helperze i pokryć testem wyścigu, zamiast kopiować
kod reconcileMerchantPayment. Zamknięcie zmiany blokuje ten sam shift
i nie może utworzyć snapshotu pomijającego zatwierdzony receipt.

## Stan zamówienia i zwrot

AWAITING_PAYMENT → PREPARING po cash/confirm. Dalej istniejące
PREPARING→READY→COLLECTED. Zmiana statusu nie tworzy następnej sprzedaży.
Wniosek o zwrot ustawia REFUND_PENDING, zachowuje poprzedni status i receipt;
blokuje dalsze wydanie. Właścicielskie potwierdzenie: REFUNDED.
Gotówka otrzymana nadal jest faktem po zwrocie; receipt pozostaje.
V1 wniosku nie można anulować; UI ostrzega przed skutkiem przed wysłaniem.
Ponowny wniosek/confirm potwierdzonego zwrotu odtwarza ten sam wynik.
Brak receipt lub próba zwrotu crypto tym endpointem daje409.
Zwrot nie odtwarza zapasu ani marży kosztu zużycia; zwrot towaru/strata
pozostają osobnymi operacjami. Brak punktów CASH V1 oznacza brak korekty
lojalności gotówkowej; refundLoyalty pozostaje w istniejącym crypto.

## Transakcje zwrotu i przypisanie wypłaty
refund/request: jedna transakcja, bieżące auth, blokada order FOR UPDATE,
następnie cashRefund jeśli istnieje. Dozwolone stany wejściowe PREPARING,
READY,COLLECTED z CASH receipt; istniejący REFUND_PENDING/REFUNDED zwraca
właściwy istniejący dokument. Pierwszy wniosek tworzy REQUESTED oraz zmienia
order na REFUND_PENDING atomowo. Odbiór i zmiana gotowości blokują ten sam
order i ponownie sprawdzają status. Gdy odbiór wygra przed wnioskiem,
wniosek nadal jest legalny z COLLECTED; gdy wniosek wygra, późniejszy odbiór
zwraca409 i nie ustawia COLLECTED. Historia zachowuje kolejność zdarzeń.
refund/confirm: jedna transakcja, blokada order, następnie refund w tej samej
kolejności; sprawdź receipt/venue/order oraz właściciela. Wyłącznie REQUESTED
z REFUND_PENDING przechodzi do CONFIRMED/REFUNDED. Już CONFIRMED odtwarza
wynik bez kolejnego skutku. Metadane potwierdzenia i audit zapisane atomowo.
Raporty odczytują dowód zwrotu, nie zwiększane poza transakcją liczniki.
Testy dwóch równoczesnych confirm oraz request kontra pickup na różnych
połączeniach PG muszą dać dozwoloną kolejność i jeden zwrot.

Wypłata właścicielska nie ma zmiany kasjera: dodaj cashRefund.payoutShiftId
nullable, zawsze null w V1. Oryginalny shiftId sprzedaży pozostaje tylko
odnośnikiem, nigdy przypisaniem wypłaty do zamkniętej zmiany. Raport lokalu
pokazuje sekcję wypłaty właścicielskie bez zmiany według confirmed_at i dnia
lokalu. Raport pierwotnej zmiany może wskazać późniejszy zwrot poza jej sumą
zamknięcia. Właściciel może potwierdzić bez aktywnej zmiany; stare snapshoty
nie są nadpisywane. Test: sprzedaż dzień1/shiftA zamknięta, wypłata dzień2
bez otwartej zmiany →1250 w dniu2 w sekcji bez zmiany, shiftA bez zmiany sum.

## Raporty i czas

Wartość sprzedaży zawiera due, nie banknot przekazany przez klienta.
Raport finance dodaje cash[] według currency z receivedMinor,
confirmedRefundsMinor,netMinor,refundLiabilityMinor oraz wpisy
CASH_PAYMENT/CASH_REFUND_CONFIRMED/CASH_REFUND_LIABILITY, z asset/network/hash
null. Fiat.salesMinor zawiera CASH i CRYPTO po jednym dokumencie sale.
Fiat.refundedSalesMinor obejmuje potwierdzone zwroty, nie REQUESTED.
Crypto assets/netCashAtomic pozostaje bez gotówki; nie zmieniaj dawnych
nazw pól na nową semantykę. CSV dodaje payment_method i cash_receipt_id
na końcu kolumn, zachowuje stare kolumny i quoting przez csvCell.
Raport produktu/operatora sumuje snapshoty sprzedaży, a nie join receipt×ruchy.
Zmiana i dzień: sprzedaż wg recorded_at, zwrot wg confirmed_at; poprzedni
snapshot zamknięcia zostaje niezmienny, późny zwrot jako późniejsze zdarzenie.
Zamknięcie pokazuje otwarte REQUESTED jako zobowiązania, nie dokonane wypłaty.
Puste cash[] dla starej historii, bez fabrykowania zer/nowych płatności.

## Błędy i interfejs

400 INVALID_INPUT: typy, zakres, strict, waluta w body, niepoprawne UUID.
401/403: istniejący brak autoryzacji/praw;404 niedostępny order.
409 ORDER_REVISION_CONFLICT, SHIFT_CLOSED, INVALID_STATE,
CASH_METHOD_UNAVAILABLE (REMOTE/reward), CASH_CUSTOMER_LINK_UNSUPPORTED,
CASH_CURRENCY_CHANGED, CRYPTO_PAYMENT_IN_PROGRESS (quote/attempt),
INSUFFICIENT_CASH, STOCK_UNAVAILABLE, IDEMPOTENCY_CONFLICT.
Klient otrzymuje polski komunikat i możliwość odświeżenia; timeout pokazuje
„sprawdzam wynik”, nie automatyczne „zapłać ponownie”. Cash-confirm disabled
podczas mutacji; ten sam klucz zachowany do sprawdzenia wyniku. GET czyta
zapisany receipt; żadna ponowna fizyczna wpłata sugerowana po reload.

UI pokazuje pełną należność, otrzymano i resztę przed potwierdzeniem.
Kwoty wejściowe jako decimal text z co najwyżej2 miejscami, PLN/EUR/USD;
odrzuć znaki minus, exponent, nadmiar precyzji i overflow. Oblicz w minor.
Przy zmianie koszyka/ceny/rabatu pokaż nową rewizję i wyczyść wpis „otrzymano”.
Anonimowy klient widzi, że brak punktów lojalnościowych za ten tryb V1.

## Ręczne zestawy kontrolne dla07–09

| Przypadek | Oczekiwany wynik |
|---|---|
| due1250, tendered2000 | receipt1250, change750, sprzedaż1250, jeden rozchód |
| tendered1200 przy due1250 | 409, brak receipt/sale/ruchu |
| dwa różne klucze potwierdzają ten sam order | jeden receipt, drugi409 |
| ten sam klucz i dane po utracie odpowiedzi | ten sam receipt i200 |
| rabat z1250 do1000 po otwarciu formularza | stara rewizja409, brak zapisu |
| quote crypto już wydane |409, brak przestawienia na gotówkę |
| 1 sztuka i równoczesne dwa order CASH/CRYPTO | jedna sprzedaż, bez ujemnego zapasu |
| sale CASH1250 i CRYPTO fiat750 | fiat sprzedaż2000, cash1250, crypto osobno |
| zwrot CASH1250 po oddaniu klientowi reszty750 | wypłata1250, netto CASH0, zapas bez wzrostu |
| wniosek1250 bez potwierdzenia | cash netto1250, zobowiązanie1250 |
| zwrot następnego dnia | pierwotna sprzedaż1250 w dniu1, zwrot1250 w dniu2 |
| otwarty formularz po dezaktywacji kasjera | odmowa, brak receipt |
| zmiana lokalu podczas starej odpowiedzi | brak danych starego lokalu w nowym widoku |

## Miejsca integracji

merchant.ts: actor/uncachedActor,venueFor,orderFor,shiftFor i istniejące
endpointy koszyka/rabatu. Zachowaj polisy i lokalne helpers, endpointy CASH
można wydzielić po przekazaniu wymaganego kontekstu, bez duplikacji auth.
merchantSettlement.ts: wzór atomowego stock/finansów, nie ścieżka RPC CASH.
stockReservations.ts: jawne źródło settlement dla consumption i blokady.
financialSale.ts: rozszerz recordFinancialSale o jawnie potwierdzony CASH
receipt (ID, zgodny order/venue/revision/snapshot) obok dotychczasowego payment.
Sam paymentMethod=CASH nigdy nie wystarcza do utworzenia dowodu sprzedaży.
Helper utrwala dokładnie raz identyczny snapshot; konflikt istniejącego
snapshotu oznacza błąd, nie ciche nadpisanie. nullable paymentHash wymaga
przeglądu każdego użycia.
stockReservations.consumeOrderStock obecnie wymaga quote-backed reservation
oraz wywołuje recordFinancialSale. Wydziel wspólną część physical sale pod
zablokowanymi zasobami; obecne consumeOrderStock zachowuje całą walidację
rezerwacji crypto. Nowy consumeCashOrderStock waliduje brak quote/attempt,
oblicza dostępność pod blokadą, wywołuje tę samą część fizyczną i zapis
finansowy oparty o receipt. Brak quote nigdy nie uprawnia do pominięcia
sprawdzenia zapasu. Całość działa w transakcji cash/confirm z rollbackiem.
services/economics.ts obecnie czyta zwroty wyłącznie z verifiedTransaction.
Dodaj osobną gałąź cashRefund CONFIRMED połączoną z financialSale, odejmij
przychód raz według confirmed_at; nie twórz wiersza crypto dla gotówki.
finance.ts/economics.ts: nowe receipt/refund w spójnym repeatable-read.
Merchant.tsx/FinanceBoard/DayCloseBoard: wybór metody, receipt i nowe sumy.
Testy cash-sale/cash-report/cash-refund z ticketów07–09 oraz niezależne sesje
PG dla wyścigów. Przegląd wszystkich miejsc czytających order.payment,
paymentHash i order.status: pickup, readiness, raporty, zwroty, recovery,
loyalty i dzień. Zapisz listę konsumentów w wyniku implementacji07.

## Uzupełnienie kolejności zapisu dla wykonawcy07
Po walidacji i zablokowaniu zasobów najpierw utwórz receipt, ustaw
order.cashReceiptId/paymentMethod/paymentSnapshot/revision/status w tej
samej niezatwierdzonej transakcji, następnie consumeCashOrderStock i wspólny
recordFinancialSale czytający te dane. Przy błędzie wszystko rollback.
Produkt bez śledzenia zapasu też otrzymuje receipt i financialSale, tylko
bez ruchów fizycznych. Test tego przypadku jest obowiązkowy.
Wspólny helper ma rozłączne gałęzie walidacji CRYPTO i CASH; nie usuwaj
warunków remote acceptance ani paymentRequiresRefund dla starej gałęzi.
