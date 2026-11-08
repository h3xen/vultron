"""Ręczny test E2E logowania do eduVULCAN (Playwright). Nie jest częścią CI.

Uruchomienie (PowerShell):
    $env:VULTRON_USER = "login"; $env:VULTRON_PASS = "haslo"
    python tests/e2e_eduvulcan_login.py            # headless
    python tests/e2e_eduvulcan_login.py --headed   # z widoczną przeglądarką

Bez zmiennych sprawdza tylko, czy formularz logowania się ładuje.
Selektory jak w vultron.py: #UserName -> Enter -> #Password -> Enter.
"""
import os
import sys

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

LOGIN_URL = "https://eduvulcan.pl/logowanie?ReturnUrl=%2Fdostep-do-dziennika%2F"
ANTI_DETECTION_SCRIPT = "delete Object.getPrototypeOf(navigator).webdriver;"
PROFILE_LINK ="a.panel-access__profile, a.connected-account.access-row, a[title='Przejdź do Dziennika']"


def main() -> int:
    user, password = os.environ.get("VULTRON_USER"), os.environ.get("VULTRON_PASS")
    headed = "--headed" in sys.argv
    shot = os.path.join(os.path.dirname(__file__), "e2e_result.png")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        context = browser.new_context()
        context.add_init_script(ANTI_DETECTION_SCRIPT)
        page = context.new_page()
        page.goto(LOGIN_URL, wait_until="domcontentloaded")
        try:
            page.locator("#UserName").wait_for(state="visible", timeout=20000)
        except PWTimeout:
            page.screenshot(path=shot)
            print(f"FAIL: brak pola #UserName ({page.url}), zrzut: {shot}")
            return 1
        print("OK: formularz logowania widoczny (#UserName)")

        # Baner zgód (cookies) może zasłaniać formularz.
        # Baner jest w iframe#respect-privacy-frame, nie w głównym dokumencie.
        consent = page.frame_locator("#respect-privacy-frame").locator("#save-default-button")
        try:
            consent.wait_for(state="visible", timeout=10000)
            consent.click()
            page.locator("#respect-privacy-frame").wait_for(state="hidden", timeout=10000)
            print("OK: kliknięto 'Zgadzam się'")
        except PWTimeout:
            print("Baner zgód nie pojawił się (pomijam)")

        if not (user and password):
            print("Pominięto logowanie: ustaw VULTRON_USER i VULTRON_PASS")
            return 0

        page.fill("#UserName", user)
        page.press("#UserName", "Enter")
        try:
            page.locator("#Password").wait_for(state="visible", timeout=15000)
        except PWTimeout:
            page.screenshot(path=shot)
            print(f"FAIL: po loginie brak pola #Password, zrzut: {shot}")
            return 1
        # Zabezpieczenie przed robotami: Enter przed 100% jest odrzucany i czyści pole.
        try:
            page.locator("span.captcha-success-label").wait_for(state="visible", timeout=60000)
        except PWTimeout:
            page.screenshot(path=shot)
            print(f"FAIL: sprawdzanie anty-robot nie zakończyło się, zrzut: {shot}")
            return 1
        print("OK: sprawdzanie anty-robot zakończone, czekam 10 s")
        page.wait_for_timeout(10000)
        page.fill("#Password", password)
        page.get_by_role("button", name="Zaloguj").click()

        try:
            page.locator(PROFILE_LINK).first.wait_for(state="attached", timeout=30000)
        except PWTimeout:
            page.screenshot(path=shot)
            print(f"FAIL: brak kafelków dziennika, url={page.url}, zrzut: {shot}")
            return 1
        links = page.locator(PROFILE_LINK).evaluate_all("els => els.map(e => e.href)")
        print(f"OK: zalogowano, kafelków dziennika: {len(links)}")
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
