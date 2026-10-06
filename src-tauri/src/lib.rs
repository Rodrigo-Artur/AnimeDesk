use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager, WindowEvent,
};
use tauri_plugin_sql::{Migration, MigrationKind};

const MAX_COVER_BYTES: usize = 8 * 1024 * 1024;
const USER_AGENT: &str = concat!("AnimeDesk/", env!("CARGO_PKG_VERSION"));

async fn kitsu_client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(15))
    .build()
    .map_err(|error| format!("Falha ao preparar cliente Kitsu: {error}"))
}

async fn kitsu_anime_query(
  client: &reqwest::Client,
  params: Vec<(String, String)>,
) -> Result<serde_json::Value, String> {
  let response = client
    .get("https://kitsu.io/api/edge/anime")
    .query(&params)
    .header(reqwest::header::USER_AGENT, USER_AGENT)
    .send()
    .await
    .map_err(|error| format!("Falha ao consultar o Kitsu: {error}"))?;

  if !response.status().is_success() {
    return Err(format!("Kitsu respondeu HTTP {}.", response.status()));
  }

  response
    .json::<serde_json::Value>()
    .await
    .map_err(|error| format!("Resposta invÃƒÂ¡lida do Kitsu: {error}"))
}

#[tauri::command]
async fn fetch_kitsu_discover(
  kind: String,
  season: Option<String>,
  year: Option<i32>,
) -> Result<serde_json::Value, String> {
  let client = kitsu_client().await?;

  if kind == "trending" {
    let trending = client
      .get("https://kitsu.io/api/edge/trending/anime")
      .header(reqwest::header::USER_AGENT, USER_AGENT)
      .send()
      .await
      .map_err(|error| format!("Falha ao consultar trending do Kitsu: {error}"))?;

    if !trending.status().is_success() {
      return Err(format!("Kitsu trending respondeu HTTP {}.", trending.status()));
    }

    let trending_json = trending
      .json::<serde_json::Value>()
      .await
      .map_err(|error| format!("Resposta invÃƒÂ¡lida do Kitsu trending: {error}"))?;

    let ids: Vec<String> = trending_json
      .get("data")
      .and_then(|value| value.as_array())
      .map(|items| {
        items
          .iter()
          .filter_map(|item| item.get("id").and_then(|value| value.as_str()).map(str::to_owned))
          .collect()
      })
      .unwrap_or_default();

    if ids.is_empty() {
      return Ok(serde_json::json!({ "data": [], "included": [] }));
    }

    let mut payload = kitsu_anime_query(
      &client,
      vec![
        ("filter[id]".into(), ids.join(",")),
        ("page[limit]".into(), "20".into()),
        ("include".into(), "mappings,categories,animeProductions.producer".into()),
      ],
    )
    .await?;

    if let Some(data) = payload.get_mut("data").and_then(|value| value.as_array_mut()) {
      data.sort_by_key(|item| {
        let id = item.get("id").and_then(|value| value.as_str()).unwrap_or_default();
        ids.iter().position(|candidate| candidate == id).unwrap_or(usize::MAX)
      });
    }

    return Ok(payload);
  }

  let mut params = vec![
    ("page[limit]".into(), "18".into()),
    ("include".into(), "mappings,categories,animeProductions.producer".into()),
  ];

  match kind.as_str() {
    "popular" => {
      params.push(("sort".into(), "-userCount".into()));
    }
    "top" => {
      params.push(("sort".into(), "-averageRating".into()));
    }
    "current" => {
      params.push(("filter[status]".into(), "current".into()));
      params.push(("sort".into(), "-userCount".into()));
    }
    "upcoming" => {
      params.push(("filter[status]".into(), "upcoming".into()));
      params.push(("sort".into(), "startDate".into()));
    }
    "seasonal" => {
      let season = season
        .filter(|value| matches!(value.as_str(), "winter" | "spring" | "summer" | "fall"))
        .ok_or_else(|| "Temporada invÃƒÂ¡lida para descoberta.".to_string())?;
      let year = year.ok_or_else(|| "Ano ausente para descoberta sazonal.".to_string())?;
      params.push(("filter[season]".into(), season));
      params.push(("filter[seasonYear]".into(), year.to_string()));
      params.push(("sort".into(), "-userCount".into()));
    }
    _ => return Err("Tipo de descoberta invÃƒÂ¡lido.".into()),
  }

  kitsu_anime_query(&client, params).await
}

#[tauri::command]
async fn enrich_kitsu_by_mal_ids(
  media_type: String,
  mal_ids: Vec<i64>,
) -> Result<serde_json::Value, String> {
  if media_type != "anime" && media_type != "manga" {
    return Err("Tipo de mÃƒÂ­dia invÃƒÂ¡lido para enriquecimento.".into());
  }

  if mal_ids.is_empty() {
    return Ok(serde_json::json!({
      "mappings": [],
      "media": { "data": [], "included": [] }
    }));
  }

  if mal_ids.len() > 20 {
    return Err("O enriquecimento aceita no mÃƒÂ¡ximo 20 IDs por lote.".into());
  }

  if mal_ids.iter().any(|id| *id <= 0) {
    return Err("A lista contÃƒÂ©m MAL ID invÃƒÂ¡lido.".into());
  }

  let client = kitsu_client().await?;
  let external_site = if media_type == "anime" {
    "myanimelist/anime"
  } else {
    "myanimelist/manga"
  };
  let ids_csv = mal_ids
    .iter()
    .map(i64::to_string)
    .collect::<Vec<_>>()
    .join(",");

  let mappings_response = client
    .get("https://kitsu.io/api/edge/mappings")
    .query(&[
      ("filter[externalSite]", external_site),
      ("filter[externalId]", ids_csv.as_str()),
      ("page[limit]", "20"),
      ("include", "item"),
    ])
    .header(reqwest::header::USER_AGENT, USER_AGENT)
    .send()
    .await
    .map_err(|error| format!("Falha ao resolver MAL IDs no Kitsu: {error}"))?;

  if !mappings_response.status().is_success() {
    return Err(format!(
      "Kitsu mappings respondeu HTTP {}.",
      mappings_response.status()
    ));
  }

  let mappings_json = mappings_response
    .json::<serde_json::Value>()
    .await
    .map_err(|error| format!("Resposta invÃƒÂ¡lida do Kitsu mappings: {error}"))?;

  let mappings = mappings_json
    .get("data")
    .and_then(|value| value.as_array())
    .cloned()
    .unwrap_or_default();

  let kitsu_ids: Vec<String> = mappings
    .iter()
    .filter_map(|mapping| {
      mapping
        .get("relationships")
        .and_then(|value| value.get("item"))
        .and_then(|value| value.get("data"))
        .and_then(|value| value.get("id"))
        .and_then(|value| value.as_str())
        .map(str::to_owned)
    })
    .collect();

  if kitsu_ids.is_empty() {
    return Ok(serde_json::json!({
      "mappings": mappings,
      "media": { "data": [], "included": [] }
    }));
  }

  let endpoint = format!("https://kitsu.io/api/edge/{media_type}");
  let include = if media_type == "anime" {
    "categories,animeProductions.producer"
  } else {
    "categories"
  };

  let media_response = client
    .get(endpoint)
    .query(&[
      ("filter[id]", kitsu_ids.join(",")),
      ("page[limit]", "20".into()),
      ("include", include.into()),
    ])
    .header(reqwest::header::USER_AGENT, USER_AGENT)
    .send()
    .await
    .map_err(|error| format!("Falha ao buscar metadados Kitsu: {error}"))?;

  if !media_response.status().is_success() {
    return Err(format!(
      "Kitsu metadados respondeu HTTP {}.",
      media_response.status()
    ));
  }

  let media_json = media_response
    .json::<serde_json::Value>()
    .await
    .map_err(|error| format!("Resposta invÃƒÂ¡lida dos metadados Kitsu: {error}"))?;

  Ok(serde_json::json!({
    "mappings": mappings,
    "media": media_json
  }))
}

fn decode_basic_html_entities(value: &str) -> String {
  value
    .replace("&amp;", "&")
    .replace("&quot;", "\"")
    .replace("&#039;", "'")
    .replace("&#39;", "'")
    .replace("&#x27;", "'")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
}

fn extract_mal_studios(html: &str) -> Vec<String> {
  let marker = r#"<span class="dark_text">Studios:</span>"#;
  let Some(marker_index) = html.find(marker) else {
    return Vec::new();
  };

  let after_marker = &html[marker_index + marker.len()..];
  let block_end = after_marker.find("</div>").unwrap_or(after_marker.len());
  let mut rest = &after_marker[..block_end];
  let mut studios = Vec::new();

  while let Some(title_index) = rest.find("title=\"") {
    let after_title = &rest[title_index + 7..];
    let Some(end_index) = after_title.find('"') else {
      break;
    };

    let name = decode_basic_html_entities(after_title[..end_index].trim());
    if !name.is_empty() && !studios.iter().any(|studio| studio == &name) {
      studios.push(name);
    }

    rest = &after_title[end_index + 1..];
  }

  studios
}

#[tauri::command]
async fn fetch_mal_studios(mal_ids: Vec<i64>) -> Result<serde_json::Value, String> {
  if mal_ids.len() > 20 {
    return Err("A consulta de estÃºdios aceita no mÃ¡ximo 20 MAL IDs por lote.".into());
  }

  if mal_ids.iter().any(|id| *id <= 0) {
    return Err("A lista contÃ©m MAL ID invÃ¡lido.".into());
  }

  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(12))
    .build()
    .map_err(|error| format!("Falha ao preparar cliente MAL: {error}"))?;

  let mut result = serde_json::Map::new();

  for mal_id in mal_ids {
    let url = format!("https://myanimelist.net/anime/{mal_id}");
    let studios = match client
      .get(url)
      .header(reqwest::header::USER_AGENT, USER_AGENT)
      .send()
      .await
    {
      Ok(response) if response.status().is_success() => match response.text().await {
        Ok(html) => extract_mal_studios(&html),
        Err(_) => Vec::new(),
      },
      _ => Vec::new(),
    };

    result.insert(mal_id.to_string(), serde_json::json!(studios));
  }

  Ok(serde_json::Value::Object(result))
}

#[tauri::command]
async fn search_myanimelist(
  media_type: String,
  keyword: String,
) -> Result<serde_json::Value, String> {
  if media_type != "anime" && media_type != "manga" {
    return Err("Tipo de mÃƒÂ­dia invÃƒÂ¡lido.".into());
  }

  let keyword = keyword.trim();
  if keyword.len() < 2 {
    return Err("Digite pelo menos 2 caracteres.".into());
  }
  if keyword.len() > 200 {
    return Err("Termo de busca muito longo.".into());
  }

  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(12))
    .build()
    .map_err(|error| format!("Falha ao preparar cliente HTTP: {error}"))?;

  let response = client
    .get("https://myanimelist.net/search/prefix.json")
    .query(&[
      ("type", media_type.as_str()),
      ("keyword", keyword),
      ("v", "1"),
    ])
    .header(reqwest::header::USER_AGENT, USER_AGENT)
    .send()
    .await
    .map_err(|error| format!("Falha ao consultar o MyAnimeList: {error}"))?;

  if !response.status().is_success() {
    return Err(format!(
      "MyAnimeList respondeu HTTP {}.",
      response.status()
    ));
  }

  response
    .json::<serde_json::Value>()
    .await
    .map_err(|error| format!("Resposta invÃƒÂ¡lida do MyAnimeList: {error}"))
}

fn cover_extension(content_type: Option<&str>, url: &str) -> &'static str {
  if let Some(content_type) = content_type {
    if content_type.contains("image/png") {
      return "png";
    }
    if content_type.contains("image/webp") {
      return "webp";
    }
    if content_type.contains("image/gif") {
      return "gif";
    }
  }

  let lower = url.to_ascii_lowercase();
  if lower.contains(".png") {
    "png"
  } else if lower.contains(".webp") {
    "webp"
  } else if lower.contains(".gif") {
    "gif"
  } else {
    "jpg"
  }
}

#[tauri::command]
async fn cache_cover(
  app: tauri::AppHandle,
  url: String,
  media_type: String,
  mal_id: i64,
) -> Result<String, String> {
  if media_type != "anime" && media_type != "manga" {
    return Err("Tipo de mÃƒÂ­dia invÃƒÂ¡lido.".into());
  }
  if mal_id <= 0 {
    return Err("MAL ID invÃƒÂ¡lido.".into());
  }
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return Err("A capa precisa usar uma URL HTTP/HTTPS.".into());
  }

  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(20))
    .build()
    .map_err(|error| format!("Falha ao preparar cliente HTTP: {error}"))?;

  let response = client
    .get(&url)
    .header(reqwest::header::USER_AGENT, USER_AGENT)
    .send()
    .await
    .map_err(|error| format!("Falha ao baixar a capa: {error}"))?;

  if !response.status().is_success() {
    return Err(format!("Servidor da capa respondeu HTTP {}.", response.status()));
  }

  if let Some(length) = response.content_length() {
    if length as usize > MAX_COVER_BYTES {
      return Err("A imagem de capa excede o limite de 8 MB.".into());
    }
  }

  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .map(str::to_owned);

  let bytes = response
    .bytes()
    .await
    .map_err(|error| format!("Falha ao ler a imagem de capa: {error}"))?;

  if bytes.len() > MAX_COVER_BYTES {
    return Err("A imagem de capa excede o limite de 8 MB.".into());
  }

  let extension = cover_extension(content_type.as_deref(), &url);
  let covers_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Falha ao localizar AppData: {error}"))?
    .join("covers");

  std::fs::create_dir_all(&covers_dir)
    .map_err(|error| format!("Falha ao criar pasta de capas: {error}"))?;

  for old_extension in ["jpg", "png", "webp", "gif"] {
    let old_path = covers_dir.join(format!("{media_type}-{mal_id}.{old_extension}"));
    if old_path.exists() && old_extension != extension {
      let _ = std::fs::remove_file(old_path);
    }
  }

  let cover_path = covers_dir.join(format!("{media_type}-{mal_id}.{extension}"));
  std::fs::write(&cover_path, &bytes)
    .map_err(|error| format!("Falha ao salvar a capa: {error}"))?;

  Ok(cover_path.to_string_lossy().to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

#[cfg(test)]
mod tests {
  use super::extract_mal_studios;

  #[test]
  fn extracts_studios_from_mal_html_block() {
    let html = r#"
      <div class="spaceit_pad">
        <span class="dark_text">Studios:</span>
        <a href="/anime/producer/11/Madhouse" title="Madhouse">Madhouse</a>,
        <a href="/anime/producer/999/Studio_Test" title="Studio &amp; Test">Studio &amp; Test</a>
      </div>
    "#;

    assert_eq!(
      extract_mal_studios(html),
      vec!["Madhouse".to_string(), "Studio & Test".to_string()]
    );
  }

  #[test]
  fn returns_empty_when_mal_has_no_studio_block() {
    assert!(extract_mal_studios("<html><body>sem estudio</body></html>").is_empty());
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![
    Migration {
      version: 1,
      description: "initial_animedesk_schema",
      sql: include_str!("../migrations/0001_initial.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "add_studios_to_media",
      sql: include_str!("../migrations/0002_add_studios.sql"),
      kind: MigrationKind::Up,
    },
  ];

  tauri::Builder::default()
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:animedesk.db", migrations)
        .build(),
    )
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      #[cfg(desktop)]
      {
        let open_item =
          MenuItem::with_id(app, "open", "Abrir AnimeDesk", true, None::<&str>)?;
        let quit_item =
          MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

        let mut tray = TrayIconBuilder::with_id("animedesk-tray")
          .tooltip("AnimeDesk")
          .menu(&menu)
          .show_menu_on_left_click(false)
          .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
          })
          .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
              button: MouseButton::Left,
              button_state: MouseButtonState::Up,
              ..
            } = event
            {
              show_main_window(tray.app_handle());
            }
          });

        if let Some(icon) = app.default_window_icon() {
          tray = tray.icon(icon.clone());
        }

        tray.build(app)?;
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      cache_cover,
      search_myanimelist,
      fetch_kitsu_discover,
      enrich_kitsu_by_mal_ids,
      fetch_mal_studios
    ])
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        let _ = window.hide();
        api.prevent_close();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running AnimeDesk");
}
