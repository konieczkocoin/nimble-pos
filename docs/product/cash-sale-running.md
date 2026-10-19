# Gotówka — kandydat implementacji zadania07

Baza494d802, gałąź recovery/production-drafts. Kandydat rozwojowy, bez wdrożenia i bez natywnego odbioru PostgreSQL. Zadania08 (raporty) i09 (zwroty) nie są zamknięte.

## Zachowanie
Kasjer na własnej otwartej zmianie może potwierdzić fizycznie otrzymaną gotówkę dla anonimowego zamówienia COUNTER. Waluty EUR/PLN/USD; kwoty w minor units, parsowanie tekstu bez float. Dla1250 i2000 reszta750. W jednej transakcji zapisujemy receipt, zamrożony snapshot, PREPARING, rozchód magazynu/wycenę, financialSale i audyt. Bez quote, hasha blockchain, rezerwacji kryptowalutowej i punktów lojalnościowych.

POST /v1/merchant/orders/:orderId/cash/confirm przyjmuje {revision,tenderedMinor} i Idempotency-Key. Powtórzenie tego samego payloadu i klucza odtwarza ten sam receipt również po zamknięciu zmiany; inny payload lub nowy klucz po zapisie jest odrzucany. GET /v1/merchant/orders/:orderId/cash/receipt odzyskuje potwierdzenie. Publiczne zamówienie otrzymuje tylko podsumowanie bez otrzymanych banknotów i reszty.

Brak zapasu, nieaktualna rewizja, zamknięta zmiana, powiązany klient/loyalty, historia quote lub próba płatności portfelem blokują nowy zapis. Zasoby bez śledzenia nie tworzą ruchu, ale nadal powstaje financialSale. Sprzeczny istniejący financialSale powoduje rollback całej transakcji.

## UI i odzyskiwanie
Panel gotówki jest w rzeczywistym ekranie sprzedaży kasjera, z podsumowaniem należne/otrzymane/reszta. Kolejka pozwala otworzyć potwierdzenie. Klient widzi zamówienie opłacone; nie widzi propozycji ponownej płatności ani zbierania punktów.

Zapisana przed POST próba przetrwa reload i zachowuje dokładny payload/klucz. Niepewny wynik blokuje ponowne przyjęcie pieniędzy, pozwalając sprawdzić receipt lub ponowić tę samą próbę bez otwartej zmiany. Uszkodzona pamięć urządzenia blokuje nowy zapis; błąd jej czyszczenia nie podważa już potwierdzonej sprzedaży. Zmiana rewizji czyści niezatwierdzoną kwotę. Aktualny odczyt zamówienia ma pierwszeństwo również przy równej rewizji, bo quote/claim nie muszą jej zwiększać.

## Migracja i blokady
0043_cash_receipts.sql jest addytywna, zawiera FK i ograniczenia kwot. Journal uzupełniony; zachowano dotychczasowy styl ręcznych migracji0041/0042 bez fabrykowania snapshotów Drizzle. Migracje przechodzą w świeżej bazie testów PGlite; natywny upgrade pozostaje bramką01.

Kolejność blokad dostosowano do istniejącego kodu: shift → order → aktualne uprawnienia FOR SHARE → posortowane zasoby. Odmienna pierwotna sugestia order→shift w kontrakcie powodowałaby ryzyko deadlocka z istniejącym status/close. Dostęp jest sprawdzany ponownie w transakcji przed odtworzeniem i zapisem wyniku.

## Przegląd
Oddzielne przeglądy Spec i Standards. Poprawiono świeżość uprawnień, konflikt snapshotu, czyszczenie kwoty po rewizji, bieżący stan shared order, odzyskiwanie bez zmiany oraz wyłączenie loyalty. Powtórny Spec: bez kolejnej istotnej uwagi. Standards wskazał dodatkowo równą rewizję przy quote — uwzględniono >=. Opcjonalny przyszły refactor: jedno jawne pojęcie stanu odzyskiwania zamiast kilku flag.

## Weryfikacja
- Ukierunkowane API PGlite:35/35 w4 plikach, w tym cash-sale9/9.
- Pełne API PGlite w5 shardach:390/391 w77 plikach. Jedyny błąd merchantNotificationPersistence.test.ts wymaga natywnego PostgreSQL (ten sam otwarty problem środowiska).
- Pełne web:300/300 w70 plikach; shared58/58 w9 plikach. Liczby i źródła: cash-sale-validation.json.
- API tsc --noEmit zaliczony. Web build zaliczony; znane ostrzeżenie dużego JS pozostaje R07.
- node scripts/test-native-postgres.mjs test/cash-sale.test.ts: FAIL przed testami, brak NATIVE_POSTGRES_BIN i NATIVE_POSTGRES_TEST_URL. Bez niezależnych sesji PostgreSQL nie zamykamy współbieżności ani zadania07 jako odebranego.

## Co następne
08: jawny podział raportów i eksportów CASH/CRYPTO. Obecne minimalne sumy liczą obie sprzedaże, bez dodawania gotówki do aktywów blockchain.
09: zwroty gotówkowe i fizyczne potwierdzenie wypłaty. Obecnie ukryte w UI, API zwraca CASH_REFUND_NOT_AVAILABLE. Nie uruchamiać operacyjnie przed tymi bramkami i natywnym odbiorem.
Pełna kopia tego etapu: NIMBLE-CASH-SALE-FULL-CODE.zip; tworzona po czystym commicie, z pełną historią i sprawdzeniem odtworzenia. Poprzednia kopia zachowana: NIMBLE-DRAFT-EXECUTION-FULL-CODE.zip, libfile_b0db38c37f6c8191b8f6ed9df63c2669.

## Aktualny odbiór — 19.10.2026

API test/cash-sale.test.ts: 9/9 PASS w pełnym natywnym run39246316523 (PostgreSQL16.15, pełne API401/401). UI test/cash-sale.test.tsx: 6/6 PASS w aktualnym lokalnym przebiegu18/18 dla03–09.
Niezależny audyt Spec nie znalazł luk w kryteriach ticketu. Poprzednie
opisy otwartej bramki PostgreSQL są historyczne; aktualne dowody:
native-postgres-acceptance-20261019.json/.txt i acceptance-01-09-running.md.
Brak wdrożenia i odbioru fizycznego telefonu w tym etapie.
