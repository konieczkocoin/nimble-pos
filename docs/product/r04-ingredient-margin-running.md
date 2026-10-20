# R04 — raport marży składnikowej

Baza: 44112c0. Gałąź recovery/r04-cost-history. Kandydat rozwojowy, bez
wdrożenia. R03 i natywny PostgreSQL nadal są otwarte.

Jako właściciel chcę znać przychód po rabatach/zwrotach i historyczny koszt
zużytych składników produktu oraz grupy menu, aby ocenić marżę składnikową.

Kontrakt:
- Nowe rozchody sprzedaży mają jawny związek z zamówieniem. Nie odtwarzamy
  starych związków z tekstowego opisu ruchu. Dawny brak związku lub ceny daje
  koszt/marżę nieznaną, a nie zero.
- Raport /venues/:venueId/economics dostępny tylko właścicielowi. Okres UTC
  [from,until), maksymalnie 366 dni, ograniczenia rozmiaru odrzucają cały
  raport zamiast zwracać niepełne sumy. Jedna transakcja repeatable read.
- Sprzedaż jest datowana przyjęciem z merchantFinancialSale, zwrot chwilą
  potwierdzenia z merchantVerifiedTransaction. Koszt zużytych składników
  obciąża okres przyjęcia raz; zwrot pieniędzy nie przywraca składników.
- Rabat całego zamówienia jest dzielony proporcjonalnie do pierwotnych wartości
  pozycji. Koszt wspólnego składnika dzielony jest według zamrożonych ilości
  receptury/wiązania. Wszystkie kwoty i marże są dokładnymi ułamkami minor.
- Grupa menu jest zamrożona w nowej pozycji zamówienia. Dawny brak grupy jest
  jawnie nieznany. Nie stosujemy bieżącego menu, ceny składnika ani kursu FX.
- Produkcja jest przesunięciem wartości na półprodukt, nie dodatkowym kosztem
  sprzedaży. Raport obciąża produkt dopiero faktycznym rozchodem przy sprzedaży.
- Straty, spisy, korekty, odwrócenia i niepowiązane rozchody/nagrody są osobnymi
  zmianami wartości zapasu ze znakiem. Nie odejmujemy ich ponownie od marży
  produktu. Brak dawnej wyceny daje ostrzeżenie i nieznaną wartość.
- To marża składnikowa, nie zysk netto; nie obejmuje pracy, czynszu, podatków.

Ekran właściciela w sekcji rozliczeń finansowych ma niezależny zakres UTC,
stan ładowania/błędu/pusty, utrzymuje ostatni udany raport przy awarii, usuwa
wynik po utracie uprawnienia i ignoruje spóźnione odpowiedzi starego konta/lokalu.
Na ekranie kwoty zaokrąglone do minor; dokładne ułamki w rozwijanych szczegółach.

Kontrole ręczne:
- Sprzedaż 900, składnik 100: marża 800. Po zwrocie 900: marża -100.
- Dwie pozycje 1000/2000, rabat 1: przychody 2999/3 i 5998/3.
  Koszty 100+100: marża grupy 2799, bez zaokrąglania pozycji.
- Składnik 100 dzielony produkcją na dwie porcje: koszt sprzedanej porcji 50,
  marża przy cenie 1000 wynosi 950; rozchód produkcji nie jest doliczany ponownie.
- Ponowienie straty nie tworzy drugiej wartości, koszt nieznany daje null.

Wyniki końcowe zostaną dopisane po przeglądzie i regresji. Pełny odbiór R04
wymaga natywnej migracji, niezależnych sesji i domknięcia R03. Kontrola telefonu
oraz pełny dzień lokalu należą do dalszych etapów planu.


## Weryfikacja końcowa

- Nowe API: 4/4; widok właściciela: 3/3 przypadki.
- Pełny zestaw API w pięciu częściach, raporty JSON: 367/368 testów,
  70/71 plików. Zweryfikowano pokrycie wszystkich 71 plików, bez duplikatów,
  pominięć ani testów pending. Części: 87/87, 65/65, 81/82, 60/60, 74/74.
- Jedyna porażka: merchantNotificationPersistence.test.ts — AggregateError
  połączenia sieciowego. Oddzielna kontrola portu 127.0.0.1:5433 dała
  ConnectionRefusedError (111). Nie uruchomiono natywnego PostgreSQL.
- Web: 284/284, 64/64 plików. Shared: 57/57, 8/8 plików.
- API TypeScript oraz web TypeScript/build: zaliczone. Bundle JS 817,99 kB,
  gzip 240,43 kB; ostrzeżenie >500 kB pozostaje zadaniem R07.
- Spec: dwa braki poprawiono — osobne korekty dostaw oraz rozwijane dokładne
  wartości grup i zmian zapasu. Po poprawkach brak usterek blokujących.
- Standards: brak usterek blokujących. Dodano indeks venue_id/created_at
  dla raportu zapasów. Powielenie małej arytmetyki ułamków pozostaje uwagą
  utrzymaniową. Obydwie osie przeglądu wykonano niezależnie.

Komendy: w apps/api uruchomić node node_modules/vitest/vitest.mjs run
--config vitest.pglite.config.ts --shard=N/5 --reporter=json
--outputFile=<plik-N.json>, dla N=1..5. Web/shared: corepack pnpm --filter
@nimble/web test i corepack pnpm --filter @nimble/shared test.

Wszystkie wyniki są pomocnicze; PGlite nie dowodzi niezależnych sesji.
Migracje 0041/0042, finanse i nowy raport muszą przejść natywny odbiór R03/R04
na końcowym SHA. Nie wykonano wdrożenia ani pusha nowych commitów.
