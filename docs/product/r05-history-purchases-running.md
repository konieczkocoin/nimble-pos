# R05 — podpowiedzi zakupowe z historii, pierwszy fragment

Baza 13279b0. Gałąź recovery/r05-history-purchases. Rozwój warunkowego
kandydata; brak natywnego odbioru R03/R04 nadal blokuje odbiór/scalenie.

Jako właściciel lub uprawniony kierownik chcę znać liczby stojące za propozycją
zakupu, aby po własnej korekcie zapisać szkic, bez automatycznego zamawiania.

Zakres:
- GET inventory/purchases/history przyjmuje pełne dni UTC [from,until), 3–90
  dni historii, do dzisiejszej północy, i horyzont 1–30 dni.
- Źródło: fizyczne rozchody SALE (w tym nagrody) i składników PRODUCTION;
  zwroty składników PRODUCTION_REVERSAL pomniejszają zapisane zużycie.
  Przyjęcie półproduktu oraz cofnięcie jego przyjęcia nie tworzą popytu.
- Projekcja dotyczy zapisanej aktywności, nie brakującego popytu klientów.
  Wymagane minimum: zasób istniał przez cały okres, 3 rozchody i 3 dni
  z rozchodem. To jawna reguła operacyjna, nie model statystycznej pewności.
- Cel = ceil(zużycie netto × horyzont / dni) + opcjonalne
  ceil(zastosowane straty × horyzont / dni) + bufor progu.
  Propozycja = max(0, cel − dostępne − dostawy w drodze).
- Dostępne uwzględnia fizyczny stan, rezerwacje i oczekujące straty;
  dostawy uwzględniają tylko niezrealizowane ilości, a nie szkice zakupu.
- Straty historyczne widoczne osobno i domyślnie wyłączone z prognozy.
  Spisy/korekty nie są arbitralnie uznawane za popyt lub zepsucie żywności.
- Niewystarczająca historia, wyłączony zasób i przekroczenie limitu ilości
  dają null z przyczyną, bez zastępowania propozycji starą regułą progu.
- Jeden snapshot repeatable read, limity rozmiaru kończą się błędem,
  a nie cichym obcięciem. Dokładne obliczenia całkowite BigInt.

Ekran zakupów pokazuje okres, próbkę, aktywne dni, ilości, wzór i wynik.
Kopiowanie propozycji wypełnia istniejący edytowalny formularz szkicu,
nie zapisuje ani nie zatwierdza zamówienia. Wybór dostawcy i zapis są osobnymi
krokami. Istniejąca idempotencja zapisu zachowuje ten sam szkic po retry.
Przy ponad 100 proponowanych pozycjach kopiowanie jest zablokowane i jawne;
trzeba wpisać sprawdzony wybór w formularzu. Nie oceniamy pracowników.

Ograniczenia: pierwszy fragment dotyczy zakupów, nie rekomendacji produkcji.
Nie zmieniono wcześniejszych prostych podpowiedzi progowych — są osobną,
wyraźnie opisaną funkcją. Wyjaśnienie okresu i opcji trafia do edytowalnego
powodu zakupu; pełny snapshot modelu nie jest osobnym trwałym dokumentem.
To nie jest odtworzenie identycznego utraconego kodu PL-22.


Dni bez wpisów wnoszą zero zarejestrowanego zużycia do średniej z pełnego
okresu; nie dowodzi to rzeczywistego braku popytu. Ta granica jest jawna w UI.
Ręczny zestaw: 18 jednostek w 7 dni, horyzont 3 → ceil(54/7)=8.
Bufor 5, stan 5, rezerwacje 3, strata oczekująca 1 → dostępne 1.
Dostawy 4 → propozycja 8. Historyczna strata 1, opcja włączona → +1,
propozycja 9. Użytkownik zmienia 8 na 7, zapis i retry tworzą jeden szkic 7.
Trzy produkcje po jednym składniku, jedna cofnięta → zużycie netto 2;
cofnięcie przyjęcia półproduktu nie jest nowym popytem na półprodukt.


## Wyniki tego fragmentu

- API nowych podpowiedzi: 3/3; UI nowej funkcji: 2/2 (z dotychczasowymi
  testami zakupów razem 5/5).
- Pełne API przez PGlite w pięciu częściach: 370/371 testów, 71/72 plików.
  Raporty JSON potwierdziły wszystkie 72 pliki bez duplikatów, braków i pending.
  Części: 87/87, 65/65, 76/77, 67/67, 75/75.
- Jedyny nieudany test: merchantNotificationPersistence.test.ts, wymagający
  natywnego połączenia PostgreSQL. Nie oznaczamy całego API jako zielonego.
- Web: 286/286, 65 plików; shared: 57/57, 8 plików.
- API TypeScript oraz web build/TypeScript: zaliczone. Ostrzeżenie rozmiaru
  JS >500 kB pozostaje w R07.
- Spec: brak usterek blokujących. Standards: brak usterek blokujących;
  powtórzenia obsługi zakresów/dat i cyklu odczytu raportu to nieblokująca
  uwaga utrzymaniowa. Dwa przeglądy wykonano niezależnie.

Odtworzenie regresji: w apps/api node node_modules/vitest/vitest.mjs run
--config vitest.pglite.config.ts --shard=N/5 --reporter=json
--outputFile=<N.json>, N=1..5. Pozostałe: corepack pnpm --filter @nimble/web
test; corepack pnpm --filter @nimble/shared test.

Stan: zakupowy fragment R05 zaimplementowany i pomocniczo sprawdzony.
Rekomendacje produkcji, natywny PostgreSQL oraz pełny odbiór R05 są nadal
otwarte. Nie uruchomiono nowych migracji, wdrożenia ani pusha tej gałęzi.
