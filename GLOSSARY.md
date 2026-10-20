# Nimble — sprzedaż w lokalu

Nimble obsługuje zamówienia i płatności kryptowalutowe w małych lokalach z obsługą przy ladzie.

## Language

**Właściciel (Owner)**:
Osoba zarządzająca lokalem i jego utargiem, uprawniona do ustalania cen, zarządzania kasjerami i zatwierdzania wypłat.
_Avoid_: Administrator portfela, kasjer główny

**Kasjer (Cashier)**:
Pracownik przyjmujący zamówienia i obsługujący ich realizację na współdzielonym telefonie, bez prawa wydawania utargu lokalu.
_Avoid_: Właściciel, ogólne „użytkownik”

**Kierownik (Manager)**:
Pracownik lokalu z wybranymi uprawnieniami operacyjnymi nadanymi przez właściciela. Sama rola nie daje prawa wydawania utargu.
_Avoid_: Współwłaściciel, portfel kierownika

**Uprawnienie operacyjne (Operational permission)**:
Zgoda właściciela na określony rodzaj czynności w jego lokalu, np. zarządzanie menu lub odczyt raportu.
_Avoid_: Prawo do portfela, pełny dostęp

**Dziennik decyzji (Audit log)**:
Historia istotnych zmian w lokalu, wskazująca autora, czas oraz zakres zmiany i jej uzasadnienie.
_Avoid_: Historia płatności, ocena pracownika

**Klient (Customer)**:
Osoba kupująca produkty w lokalu, zatwierdzająca swoją płatność i odbierająca zamówienie.
_Avoid_: Kasjer, operator

**Lokal (Venue)**:
Punkt sprzedaży ze wspólnym menu, walutą cen, kasjerami i adresami do otrzymywania płatności.
_Avoid_: Portfel, konto kasjera

**Stanowisko kasowe (Terminal)**:
Telefon przypisany do lokalu, na którym kolejno pracują jego kasjerzy.
_Avoid_: Terminal kartowy, portfel właściciela

**Zmiana (Shift)**:
Okres pracy konkretnego kasjera, do którego przypisane są przyjęte przez niego zamówienia.
_Avoid_: Sesja płatności, dzień kalendarzowy

**Zamówienie (Order)**:
Zestaw produktów, wariantów i dodatków kupowanych razem, z własnym numerem i stanem realizacji.
_Avoid_: Transakcja blockchain, przelew

**Wariant (Variant)**:
Jedna z dostępnych wersji produktu, z własną ceną, np. rozmiar kawy.
_Avoid_: Dodatek

**Dodatek (Extra)**:
Opcjonalne uzupełnienie produktu z ustaloną dopłatą, np. mleko owsiane lub dodatkowy shot.
_Avoid_: Wariant

**Kod płatności (Payment code)**:
Tymczasowy sześciocyfrowy kod klienta służący do połączenia go z prośbą o płatność.
_Avoid_: Numer zamówienia, tajne hasło

**Wycena płatności (Quote)**:
Dokładna kwota w wybranej kryptowalucie, wyliczona dla konkretnego podsumowania zamówienia i ważna przez określony czas.
_Avoid_: Cena produktu, orientacyjne przeliczenie

**Zwrot (Refund)**:
Potwierdzone oddanie klientowi kwoty zapłaty: fizyczna wypłata gotówki w walucie sprzedaży albo osobny przelew właściciela w pierwotnym aktywie. Wniosek o zwrot nie oznacza jego wykonania.
_Avoid_: Cofnięcie transakcji, anulowanie opłaconego zamówienia

**Sygnał odbioru (Pickup signal)**:
Wiadomość o gotowości zamówienia, przekazywana klientowi również przez przelew 1 luny finansowany przez Nimble.
_Avoid_: Gwarantowany push, płatność za zamówienie

**Zasób magazynowy (Stock item)**:
Policzalny rodzaj towaru w lokalu, ewidencjonowany w sztukach lub porcjach, np. gotowe kanapki.
_Avoid_: Produkt menu, płatność

**Ruch magazynowy (Stock movement)**:
Zarejestrowana zmiana ilości zasobu z podaniem autora i powodu.
_Avoid_: Edycja historii, zmiana ceny

**Odwrócenie ruchu (Movement reversal)**:
Nowy ruch przeciwny do błędnego wpisu, zachowujący oryginał oraz powód korekty.
_Avoid_: Usunięcie ruchu, zwrot pieniędzy


**Historyczna wycena ruchu (Movement valuation)**:
Wartość zmiany zapasu ustalona w chwili jej zapisania, w walucie lokalu i jednostce zasobu. Późniejsze ceny jej nie zmieniają; brak znanej ceny oznacza brak wyceny, nie koszt zerowy.
_Avoid_: Zysk netto, aktualna cena zakupu

**Marża składnikowa (Ingredient margin)**:
Przychód ze sprzedaży pomniejszony o koszt zużytych składników. Nie obejmuje m.in. wynagrodzeń, czynszu i podatków.
_Avoid_: Zysk netto, utarg
