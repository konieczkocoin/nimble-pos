# AI-01 — Asystent lokalu z własnym kontem AI

Status: WKRÓTCE / BACKLOG. Zapisano 2026-10-18 na polecenie właściciela.
Nie rozpoczynać implementacji w ramach bieżącego audytu. Nie jest warunkiem
ukończenia dotychczasowego planu R01–R09. Nie ustalono daty realizacji.

Jako właściciel lokalu chcę podłączyć własne konto AI do czatu w Nimble,
aby z danych lokalu przygotować konkretne działania operacyjne.

Pierwszy zakres: wykryty brak towaru → uzasadniona propozycja zakupu →
edytowalny mail do dostawcy → jawne zatwierdzenie wysłania → status i historia.
Późniejsze rozszerzenia: newslettery i kampanie reklamowe.

Warunki projektowe:
- Rozdzielić logowanie, prawo używania modelu i połączenie z pocztą/marketingiem.
- Sprawdzić dostępność Sign in with ChatGPT dla hostowanego Nimble przed
  obiecaniem wykorzystania subskrypcji. API jako odrębny, jawnie rozliczany wariant.
- Nie zakładać importu prywatnych rozmów, pamięci ani połączeń konta AI.
- Własny kontekst lokalu, izolacja lokali, aktualne role; kasjer bez praw właściciela.
- Wysyłka i zamówienia z konkretną autoryzacją, śladem operacji i ochroną przed duplikacją.
- Claude: zweryfikować aktualne zasady i dostęp dla własnego czatu; nie zakładać
  możliwości wykorzystania abonamentu Claude Code jako zwykłego API.

Źródła rozpoznania z poprzedniej rozmowy (ponownie sprawdzić przed wdrożeniem):
https://developers.openai.com/siwc/quickstart
https://developers.openai.com/siwc/token-sharing-open-source
https://code.claude.com/docs/en/agent-sdk/overview
https://code.claude.com/docs/en/legal-and-compliance
