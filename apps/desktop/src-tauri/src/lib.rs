//! Powłoka AvenMail na komputer. Cała poczta działa na serwerze AvenMail (ADR-0088); aplikacja pokazuje
//! wspólne ekrany z @aven/mail-ui w natywnym oknie z podpisanymi aktualizacjami (ADR-0082, ADR-0089).
//!
//! Logowanie kontem Monorise (ADR-0022, RFC 8252): aplikacja otwiera ekran logowania MonoriseCore
//! w przeglądarce systemowej, a przeglądarka wraca na `http://127.0.0.1:<port>/oauth/callback`, gdzie
//! aplikacja nasłuchuje tylko na czas jednego logowania. Tokeny trzyma w systemowym sejfie.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const KEYRING_SERVICE: &str = "studio.monorise.avenmail";
const KEYRING_ACCOUNT: &str = "monorise-tokens";
const CALLBACK_PATH: &str = "/oauth/callback";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

const DONE_PAGE: &str = "<!doctype html><html lang=\"pl\"><head><meta charset=\"utf-8\"><title>AvenMail</title></head>\
<body style=\"margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui;background:#18181b;color:#fafafa\">\
<p>Zalogowano do AvenMail. Możesz zamknąć tę kartę i wrócić do aplikacji.</p></body></html>";

/// Nasłuch na powrót z logowania, otwarty przez `oauth_listen` i odebrany przez `oauth_wait`.
#[derive(Default)]
struct PendingSignIn(Mutex<Option<TcpListener>>);

/// Otwiera nasłuch na 127.0.0.1 na wolnym porcie i zwraca ten port (adres powrotu dla Core).
#[tauri::command]
fn oauth_listen(pending: tauri::State<'_, PendingSignIn>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *pending.0.lock().map_err(|e| e.to_string())? = Some(listener);
    Ok(port)
}

/// Czeka na powrót z Core (najwyżej 5 minut) i zwraca ścieżkę z parametrami: kod, stan i wystawcę.
#[tauri::command]
async fn oauth_wait(pending: tauri::State<'_, PendingSignIn>) -> Result<String, String> {
    let listener = pending
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "Logowanie nie zostało rozpoczęte".to_string())?;
    tauri::async_runtime::spawn_blocking(move || wait_for_callback(listener, SIGN_IN_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
}

fn wait_for_callback(listener: TcpListener, timeout: Duration) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(target) = answer(stream) {
                    return Ok(target);
                }
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("Logowanie trwało zbyt długo. Spróbuj jeszcze raz.".to_string());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Odpowiada na jedno żądanie przeglądarki. Powrót z Core kończy logowanie, inne żądania (np. ikona
/// strony) dostają 404 i czekamy dalej.
fn answer(mut stream: TcpStream) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buffer = [0u8; 8192];
    let mut read = 0;
    while read < buffer.len() {
        match stream.read(&mut buffer[read..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                read += n;
                if buffer[..read].windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
        }
    }
    let target = callback_target(&String::from_utf8_lossy(&buffer[..read]));
    let (status, body) = if target.is_some() { ("200 OK", DONE_PAGE) } else { ("404 Not Found", "") };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    target
}

/// Ścieżka z parametrami z pierwszej linii żądania `GET /oauth/callback?… HTTP/1.1`.
fn callback_target(request: &str) -> Option<String> {
    let mut parts = request.lines().next()?.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    (target.split('?').next()? == CALLBACK_PATH).then(|| target.to_string())
}

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

/// Tokeny z Core zapisane w systemowym sejfie (JSON) albo nic.
#[tauri::command]
fn tokens_get() -> Result<Option<String>, String> {
    match keychain_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn tokens_set(value: String) -> Result<(), String> {
    keychain_entry()?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn tokens_delete() -> Result<(), String> {
    match keychain_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(PendingSignIn::default())
        .invoke_handler(tauri::generate_handler![
            oauth_listen,
            oauth_wait,
            tokens_get,
            tokens_set,
            tokens_delete
        ])
        .run(tauri::generate_context!())
        .expect("nie udało się uruchomić AvenMail");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rozpoznaje_tylko_powrot_z_logowania() {
        assert_eq!(
            callback_target("GET /oauth/callback?code=k&state=s HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
            Some("/oauth/callback?code=k&state=s".to_string())
        );
        assert_eq!(callback_target("GET /favicon.ico HTTP/1.1\r\n\r\n"), None);
        assert_eq!(callback_target("POST /oauth/callback HTTP/1.1\r\n\r\n"), None);
        assert_eq!(callback_target("GET /oauth/callback/../inne HTTP/1.1\r\n\r\n"), None);
    }

    #[test]
    fn czeka_na_powrot_i_pomija_inne_zadania() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            for request in ["GET /favicon.ico HTTP/1.1\r\n\r\n", "GET /oauth/callback?code=k&state=s HTTP/1.1\r\n\r\n"] {
                let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
                stream.write_all(request.as_bytes()).unwrap();
                let mut response = String::new();
                stream.read_to_string(&mut response).unwrap();
                assert!(response.starts_with("HTTP/1.1"));
            }
        });
        let target = wait_for_callback(listener, Duration::from_secs(10)).unwrap();
        browser.join().unwrap();
        assert_eq!(target, "/oauth/callback?code=k&state=s");
    }

    #[test]
    fn konczy_czekanie_po_czasie() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        assert!(wait_for_callback(listener, Duration::from_millis(200)).is_err());
    }
}
