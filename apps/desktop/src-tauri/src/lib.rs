//! Powłoka AvenMail na komputer. Cała poczta działa na serwerze AvenMail (ADR-0088); aplikacja pokazuje
//! wspólne ekrany z @aven/mail-ui w natywnym oknie z podpisanymi aktualizacjami (ADR-0082, ADR-0089).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("nie udało się uruchomić AvenMail");
}
