# R05 — podpowiedź produkcyjna i edytowalny formularz

Baza d13d376. Gałąź recovery/r05-production-proposals. Kandydat rozwojowy,
bez scalenia, wdrożenia i natywnego odbioru R03/R04.

Jako właściciel chcę wyliczyć partie dla konkretnej receptury i sprawdzić
składniki, aby zdecydować o produkcji bez wpisywania prognozy jako wyniku.
Uprawniony kierownik korzysta z tego samego przepływu inventory.manage.

Kontrakt:
- GET /venues/:venueId/production/proposal: ta sama jawna historia UTC,
  minimalna próbka, projekcja zużycia/strat i dostawy produktu gotowego co
  podpowiedzi zakupowe. Wybrana wersja receptury, zasób wyjściowy oraz
  oczekiwany uzysk na partię są jawnymi założeniami operatora.
- Partie = ceil(potrzebna ilość / oczekiwany uzysk na partię).
  Planowany uzysk = partie × oczekiwany uzysk. Nie jest to faktyczny wynik.
- Wymagania = zamrożona receptura × partie; dostępność składników pomija
  rezerwacje i oczekujące straty. Nieodebrane dostawy składników nie zwiększają
  mocy produkcyjnych. Maksimum partii wynika z każdego składnika i limitów API.
- Brak historii, brak potrzeby, brak składników, wyłączone/nieśledzone zasoby
  i limity są jawne, bez automatycznego pomniejszania propozycji.
- Cykle produkcji i obce zasoby/receptury są odrzucane. Ta sama kontrola
  zależności jest użyta przy faktycznym zapisie. Odczyt ma jeden snapshot
  repeatable read. Limit historii dotyczy planowania, nie blokuje istniejącego
  zapisu produkcji po przekroczeniu 10 tys. historycznych partii.
- Odczyt nie zapisuje partii, nie zmienia stanu i niczego nie rezerwuje.
- Kopiowanie przenosi parametry do istniejącego edytowalnego formularza,
  usuwa faktyczny uzysk oraz dane poprzedniej partii/etykiety. Operator musi
  sam wpisać zmierzoną ilość i osobno zatwierdzić. Stan jest ponownie
  sprawdzany przez istniejący zapis/idempotencję produkcji.
- Zmiana konta/lokalu/receptury/założonego uzysku unieważnia poprzednią
  odpowiedź. Brak składników blokuje kopiowanie. Bieżące/niepewne operacje
  produkcyjne również blokują kopiowanie, żeby zachować bezpieczne retry.

Przykład: 18 porcji w 7 dni → na 3 dni ceil(54/7)=8; bufor3, dostępne2,
brak dostaw → potrzeba9. Uzysk4 → partie3, plan12. Receptura zużywa2 na
partię → potrzeba6 składników. Dostępne20 → maksimum10 partii. Rezerwacja17
pozostawia3 → maksimum1; propozycja3 jest zablokowana. Nieodebrane100
składników nie zmienia maksimum. Dostawa5 gotowego produktu obniża potrzebę
z9 do4, zatem jedna partia jest wykonalna.

Granice: skopiowany formularz jest roboczy i nie jest osobnym trwałym szkicem
produkcyjnym. Nie należy oznaczać trwałych planów produkcji jako wdrożonych.
Trwałe edytowalne szkice zakupowe istnieją z poprzedniego fragmentu R05.
Telefon, niezależne sesje oraz natywny PostgreSQL pozostają do odbioru.


Dodatkowa kontrola graniczna: maksymalne partie uwzględniają także
floor((2147483647 − obecny fizyczny zapas produktu) / uzysk na partię).
Potrzeba7 i wolna pojemność7 przy uzysku10 dają planowaną partię10,
lecz maksymalnie0 wykonalnych partii oraz PRODUCTION_LIMIT. Nie wolno
uznać takiej propozycji za wykonalną tylko dlatego, że składników wystarcza.
Test najpierw odtworzył błąd, następnie sprawdził poprawkę.

## Weryfikacja końcowa

API: 373/374 testy, wszystkie 73 pliki dokładnie raz, bez pominięć.
Jedyny błąd: merchantNotificationPersistence.test.ts — odzyskiwanie bajtów
i budżet między workerami wymagają natywnego PostgreSQL (port 5433).
Środowisko nadal ma mapowanie UID 0→0 długości1 i brak natywnego serwera;
PGlite nie zastępuje tej bramki. Nie oznaczamy odbioru natywnego jako zaliczonego.
Web: 288/288 w 66 plikach. Shared: 57/57 w 8 plikach. TypeScript API
oraz TypeScript/build web zaliczone. Ukierunkowane API: 10/10; UI: 4/4.
Niezależne przeglądy Spec i Standards bez pozostałych usterek blokujących
po poprawce pojemności produktu gotowego (01ff6db).
Nie wykonano odbioru telefonu ani testów niezależnych natywnych sesji.
R05 pozostaje kandydatem; trwały osobny szkic produkcji jest poza tym fragmentem.
