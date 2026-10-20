# R04 — historyczna wycena ruchów: pierwszy fragment

Baza: 0ba2d8b, gałąź recovery/r04-cost-history. Kandydat rozwojowy;
R03 nie jest odebrane na natywnym PostgreSQL. R04 nie jest ukończone.

Jako właściciel chcę odczytać wartość fizycznego ruchu zapasu z chwili jego
zapisania, aby późniejsza dostawa nie przepisywała historii kosztu składników.

Zakres tej części:
- Dowód wyceny zapisuje się atomowo z nowymi ruchami dostawy, rozchodu,
  produkcji, sprzedaży, nagrody, spisu i straty przez istniejące transakcje.
- Kwoty są dokładnymi ułamkami w najmniejszych jednostkach waluty lokalu,
  ilość jest wyrażona w bazowej jednostce zasobu. Znak odpowiada zmianie zapasu.
- Dostawa i przyjęcie produkcji używają przekazanego kosztu, zwykły rozchód
  średniej ważonej sprzed ruchu. Odwrócenie korekty neguje historyczny dowód.
- Cena nieznana daje null, a nie 0. Otwarcia i ruchy sprzed migracji mają
  valuation=null; nie odtwarzamy ich wartości z aktualnych cen.
- GET /v1/merchant/venues/:venueId/inventory/:itemId/cost-history udostępnia
  stronicowaną historię właścicielowi lub osobie z inventory.costs.
  Operacyjne odpowiedzi ruchów nie zawierają kosztów; uprawnienie sprawdzane
  jest przy każdym odczycie.
- Dowód ma jeden klucz ruchu. Retry pozostaje w istniejącej transakcji
  idempotencji; nie powstaje drugi koszt tego samego ruchu.

Granice: to historia wartości zapasu, nie raport zysku. Ruch wejściowy/wyjściowy
produkcji nie może być sumowany jako dodatkowy koszt sprzedanego dania — raport
produktu i jego alokacja dopiero powstaną. Nie wdrożono jeszcze widoku UI,
raportów marży/grup ani kompletnego kontraktu PL-21. Nie uruchomiono migracji
na produkcji. Pełna migracja/odbiór PostgreSQL 16 i R03 pozostają wymagane
przed scaleniem i odbiorem tej gałęzi.

Weryfikacja: ręczny przykład 10 groszy / 3000 mg × 1000 mg = 10/3 grosza,
ponowienie identycznego ruchu, zmiana średniej po kolejnej dostawie,
nieznany koszt, historyczne odwrócenie, osobne lokale, paginacja oraz
nadanie/odebranie uprawnienia bez ponownego logowania. Wyniki końcowe poniżej.

Ochrona waluty: po utworzeniu zasobu nie można zmienić waluty lokalu.
Pierwszy zasób i zmiana waluty blokują ten sam wiersz lokalu. Bieżąca średnia
kosztu zapisuje walutę; dawny zapis bez potwierdzonej waluty nie stanowi
podstawy nowego historycznego kosztu. Nieznana cena korekty dostawy lub
cofnięcia produkcji pozostaje nieznana, zamiast używać dzisiejszej średniej.

Przegląd code-review (Spec i Standards, niezależne oceny) znalazł dwie luki
walutowe, obie poprawiono: pochodne koszty produkcji i cofnięcia dawnych partii,
a następnie przyjęcia/korekty dawnych dostaw. Potwierdzono czerwone regresje
na poprzednich funkcjach i zielony wynik po poprawkach. Ostateczny przegląd
0ba2d8b...8aa798a: brak pozostałych usterek blokujących. Pozostała uwaga
utrzymaniowa: niewielkie powielenie arytmetyki ułamków, bez wpływu na odbiór.

Odbiór pozostaje warunkowy: nie wykonano nowego pusha, natywnej migracji ani
przebiegu PostgreSQL 16. R03 nie jest ukończone. Gałąź rozwojowa pozwala
kontynuować implementację, ale nie znosi zależności R04 od odbioru R03.


## Wynik końcowy tego fragmentu

- Nowa historia kosztów: 6/6 przypadków API (w części 1/5).
- Całe API w pięciu częściach: 363/364, 69/70 plików. Części 1–5:
  83/83, 62/62, 72/73, 64/64, 82/82. Część 5 powtórzono po zgodnej
  adaptacji fixture starej migracji finansowej (usunęła dowód zależny od
  ruchu celowo usuwanego w symulacji starych danych; asercje bez zmian).
- Jedyny pozostały błąd: merchantNotificationPersistence.test.ts,
  ECONNREFUSED ::1/127.0.0.1:5433. Wymaga natywnego PostgreSQL.
- Pełny pojedynczy przebieg nie dał podsumowania, dlatego uruchomiono
  wszystkie 70 plików bez wykluczeń w pięciu rozłącznych częściach.
  Nie deklarujemy zielonego pełnego API ani odbioru niezależnych sesji.
- TypeScript API i web: zaliczone.
- Spec: brak pozostałych blokujących usterek po poprawkach.
- Standards: brak pozostałych blokujących usterek; niewielka duplikacja
  arytmetyki ułamków pozostaje nieblokującą uwagą utrzymaniową.

Odtworzenie zestawu: w apps/api uruchomić node node_modules/vitest/vitest.mjs
run --config vitest.pglite.config.ts --shard=N/5 dla N=1,2,3,4,5.
Natywny odbiór: workflow .github/workflows/native-postgres.yml na końcowym SHA.
Następna część R04: powiązanie rozchodów z produktem/sprzedażą, dokładna
alokacja kosztu bez podwójnego liczenia produkcji, raport marży składnikowej,
strat i brakujących wycen oraz ekran właściciela. Nie uznajemy tych prac
za już wykonane. Pełne odebranie R04 i scalenie nadal zależą od R03.
