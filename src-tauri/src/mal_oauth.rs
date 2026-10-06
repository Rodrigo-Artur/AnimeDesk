use keyring::Entry;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
  io::{Read, Write},
  net::TcpListener,
  process::Command,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use url::Url;

const MAL_AUTH_URL: &str = "https://myanimelist.net/v1/oauth2/authorize";
const MAL_TOKEN_URL: &str = "https://myanimelist.net/v1/oauth2/token";
const MAL_API_BASE: &str = "https://api.myanimelist.net/v2";
pub const MAL_REDIRECT_URI: &str = "http://127.0.0.1:47821/oauth/mal/callback";
const CREDENTIAL_SERVICE: &str = "AnimeDesk";
const CREDENTIAL_USER: &str = "myanimelist-oauth";
const CALLBACK_TIMEOUT_SECS: u64 = 180;
const REFRESH_SAFETY_WINDOW_SECS: u64 = 300;

#[derive(Debug, Serialize, Deserialize)]
struct StoredTokens {
  client_id: String,
  access_token: String,
  refresh_token: String,
  expires_at: u64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
  access_token: String,
  refresh_token: Option<String>,
  expires_in: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MalAccountStatus {
  pub configured: bool,
  pub connected: bool,
  pub user_id: Option<u64>,
  pub name: Option<String>,
  pub picture: Option<String>,
  pub expires_at: Option<u64>,
  pub redirect_uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MalListItem {
  pub media_type: String,
  pub mal_id: u64,
  pub title: String,
  pub image_url: Option<String>,
  pub status: String,
  pub progress: u64,
  pub score: Option<f64>,
  pub updated_at: Option<String>,
  pub total_episodes: Option<u64>,
  pub total_chapters: Option<u64>,
  pub public_score: Option<f64>,
  pub airing_status: Option<String>,
  pub genres: Vec<String>,
  pub year: Option<i32>,
}

fn now_epoch() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

fn random_urlsafe(len: usize) -> String {
  rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(len)
    .map(char::from)
    .collect()
}

fn credential_entry() -> Result<Entry, String> {
  Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER)
    .map_err(|error| format!("Falha ao acessar o Windows Credential Manager: {error}"))
}

fn load_tokens() -> Result<Option<StoredTokens>, String> {
  let entry = credential_entry()?;
  match entry.get_password() {
    Ok(raw) => serde_json::from_str::<StoredTokens>(&raw)
      .map(Some)
      .map_err(|error| format!("Credencial MAL local está corrompida: {error}")),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(error) => Err(format!("Falha ao ler credencial MAL: {error}")),
  }
}

fn store_tokens(tokens: &StoredTokens) -> Result<(), String> {
  let raw = serde_json::to_string(tokens)
    .map_err(|error| format!("Falha ao serializar credencial MAL: {error}"))?;
  credential_entry()?
    .set_password(&raw)
    .map_err(|error| format!("Falha ao salvar credencial MAL no Windows: {error}"))
}

fn delete_tokens() -> Result<(), String> {
  let entry = credential_entry()?;
  match entry.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(error) => Err(format!("Falha ao remover credencial MAL: {error}")),
  }
}

fn html_response(stream: &mut std::net::TcpStream, ok: bool, message: &str) {
  let title = if ok { "AnimeDesk conectado" } else { "Falha no AnimeDesk" };
  let body = format!(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head>\
     <body style=\"font-family:system-ui;background:#0e1118;color:#eef;padding:40px\">\
     <h1>{title}</h1><p>{message}</p><p>Você já pode fechar esta aba e voltar ao AnimeDesk.</p></body></html>"
  );
  let response = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    body.as_bytes().len(),
    body
  );
  let _ = stream.write_all(response.as_bytes());
  let _ = stream.flush();
}

fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
  listener
    .set_nonblocking(true)
    .map_err(|error| format!("Falha ao configurar callback OAuth: {error}"))?;

  let deadline = Instant::now() + Duration::from_secs(CALLBACK_TIMEOUT_SECS);

  while Instant::now() < deadline {
    match listener.accept() {
      Ok((mut stream, _)) => {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
        let mut buffer = [0_u8; 16_384];
        let read = stream
          .read(&mut buffer)
          .map_err(|error| format!("Falha ao ler callback OAuth: {error}"))?;
        let request = String::from_utf8_lossy(&buffer[..read]);
        let request_target = request
          .lines()
          .next()
          .and_then(|line| line.split_whitespace().nth(1))
          .ok_or_else(|| "Callback OAuth inválido.".to_string())?;

        let callback = Url::parse(&format!("http://localhost{request_target}"))
          .map_err(|error| format!("Callback OAuth inválido: {error}"))?;

        if callback.path() != "/oauth/mal/callback" {
          html_response(&mut stream, false, "Rota de callback inválida.");
          continue;
        }

        let mut code: Option<String> = None;
        let mut state: Option<String> = None;
        let mut oauth_error: Option<String> = None;

        for (key, value) in callback.query_pairs() {
          match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => oauth_error = Some(value.into_owned()),
            _ => {}
          }
        }

        if let Some(error) = oauth_error {
          html_response(&mut stream, false, "O MyAnimeList recusou a autorização.");
          return Err(format!("MyAnimeList recusou a autorização: {error}"));
        }

        if state.as_deref() != Some(expected_state) {
          html_response(&mut stream, false, "A validação de segurança (state) falhou.");
          return Err("OAuth state inválido. Login cancelado por segurança.".into());
        }

        let code = code.ok_or_else(|| "Callback OAuth não contém authorization code.".to_string())?;
        html_response(&mut stream, true, "Autorização recebida com sucesso.");
        return Ok(code);
      }
      Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
        std::thread::sleep(Duration::from_millis(100));
      }
      Err(error) => return Err(format!("Falha no servidor local OAuth: {error}")),
    }
  }

  Err("Tempo limite do login MyAnimeList excedido (3 minutos).".into())
}

fn build_authorize_url(
  client_id: &str,
  verifier: &str,
  state: &str,
) -> Result<Url, String> {
  let mut auth_url = Url::parse(MAL_AUTH_URL)
    .map_err(|error| format!("URL OAuth MAL inválida: {error}"))?;

  auth_url
    .query_pairs_mut()
    .append_pair("response_type", "code")
    .append_pair("client_id", client_id)
    .append_pair("code_challenge", verifier)
    .append_pair("code_challenge_method", "plain")
    .append_pair("state", state)
    .append_pair("redirect_uri", MAL_REDIRECT_URI);

  Ok(auth_url)
}

fn open_system_browser(url: &str) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    Command::new("rundll32.exe")
      .args(["url.dll,FileProtocolHandler", url])
      .spawn()
      .map_err(|error| format!("Falha ao abrir navegador: {error}"))?;
    Ok(())
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = url;
    Err("Abertura automática do navegador está disponível apenas no Windows nesta versão.".into())
  }
}

async fn exchange_authorization_code(
  client_id: &str,
  code: &str,
  verifier: &str,
) -> Result<StoredTokens, String> {
  let response = reqwest::Client::new()
    .post(MAL_TOKEN_URL)
    .form(&[
      ("client_id", client_id),
      ("grant_type", "authorization_code"),
      ("code", code),
      ("code_verifier", verifier),
      ("redirect_uri", MAL_REDIRECT_URI),
    ])
    .send()
    .await
    .map_err(|error| format!("Falha ao trocar código OAuth por token: {error}"))?;

  if !response.status().is_success() {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    return Err(format!("MyAnimeList token HTTP {status}: {body}"));
  }

  let token = response
    .json::<TokenResponse>()
    .await
    .map_err(|error| format!("Resposta de token MAL inválida: {error}"))?;
  let refresh_token = token
    .refresh_token
    .ok_or_else(|| "MyAnimeList não retornou refresh token.".to_string())?;

  Ok(StoredTokens {
    client_id: client_id.to_string(),
    access_token: token.access_token,
    refresh_token,
    expires_at: now_epoch().saturating_add(token.expires_in),
  })
}

async fn refresh_tokens(client_id: &str, current: StoredTokens) -> Result<StoredTokens, String> {
  let response = reqwest::Client::new()
    .post(MAL_TOKEN_URL)
    .form(&[
      ("client_id", client_id),
      ("grant_type", "refresh_token"),
      ("refresh_token", current.refresh_token.as_str()),
    ])
    .send()
    .await
    .map_err(|error| format!("Falha ao renovar token MAL: {error}"))?;

  if !response.status().is_success() {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    return Err(format!("Refresh MAL HTTP {status}: {body}"));
  }

  let token = response
    .json::<TokenResponse>()
    .await
    .map_err(|error| format!("Resposta de refresh MAL inválida: {error}"))?;

  Ok(StoredTokens {
    client_id: client_id.to_string(),
    access_token: token.access_token,
    refresh_token: token.refresh_token.unwrap_or(current.refresh_token),
    expires_at: now_epoch().saturating_add(token.expires_in),
  })
}

async fn ensure_access_token(client_id: &str) -> Result<StoredTokens, String> {
  let current = load_tokens()?
    .ok_or_else(|| "Conta MyAnimeList ainda não está conectada.".to_string())?;

  if current.client_id != client_id {
    return Err(
      "O Client ID mudou desde o último login. Desconecte e autorize a conta novamente.".into(),
    );
  }

  if current.expires_at > now_epoch().saturating_add(REFRESH_SAFETY_WINDOW_SECS) {
    return Ok(current);
  }

  let refreshed = refresh_tokens(client_id, current).await?;
  store_tokens(&refreshed)?;
  Ok(refreshed)
}

async fn fetch_profile(access_token: &str) -> Result<Value, String> {
  let response = reqwest::Client::new()
    .get(format!("{MAL_API_BASE}/users/@me"))
    .query(&[("fields", "id,name,picture")])
    .bearer_auth(access_token)
    .send()
    .await
    .map_err(|error| format!("Falha ao consultar perfil MAL: {error}"))?;

  if !response.status().is_success() {
    return Err(format!("Perfil MAL respondeu HTTP {}.", response.status()));
  }

  response
    .json::<Value>()
    .await
    .map_err(|error| format!("Perfil MAL inválido: {error}"))
}

async fn connected_status(client_id: &str) -> Result<MalAccountStatus, String> {
  let tokens = ensure_access_token(client_id).await?;
  let profile = fetch_profile(&tokens.access_token).await?;

  Ok(MalAccountStatus {
    configured: true,
    connected: true,
    user_id: profile.get("id").and_then(Value::as_u64),
    name: profile.get("name").and_then(Value::as_str).map(str::to_owned),
    picture: profile.get("picture").and_then(Value::as_str).map(str::to_owned),
    expires_at: Some(tokens.expires_at),
    redirect_uri: MAL_REDIRECT_URI.to_string(),
  })
}

#[tauri::command]
pub async fn mal_oauth_status(client_id: String) -> Result<MalAccountStatus, String> {
  let configured = !client_id.trim().is_empty();
  if !configured {
    return Ok(MalAccountStatus {
      configured: false,
      connected: false,
      user_id: None,
      name: None,
      picture: None,
      expires_at: None,
      redirect_uri: MAL_REDIRECT_URI.to_string(),
    });
  }

  if load_tokens()?.is_none() {
    return Ok(MalAccountStatus {
      configured: true,
      connected: false,
      user_id: None,
      name: None,
      picture: None,
      expires_at: None,
      redirect_uri: MAL_REDIRECT_URI.to_string(),
    });
  }

  connected_status(client_id.trim()).await
}

#[tauri::command]
pub async fn mal_oauth_login(client_id: String) -> Result<MalAccountStatus, String> {
  let client_id = client_id.trim().to_string();
  if client_id.len() < 8 || client_id.len() > 200 {
    return Err("Client ID do MyAnimeList inválido.".into());
  }

  let listener = TcpListener::bind("127.0.0.1:47821")
    .map_err(|error| format!("A porta OAuth 47821 está ocupada: {error}"))?;
  let verifier = random_urlsafe(96);
  let state = random_urlsafe(48);

  let auth_url = build_authorize_url(&client_id, &verifier, &state)?;
  open_system_browser(auth_url.as_str())?;

  let callback_state = state.clone();
  let code = tauri::async_runtime::spawn_blocking(move || {
    wait_for_callback(listener, &callback_state)
  })
  .await
  .map_err(|error| format!("Falha ao aguardar callback MAL: {error}"))??;

  let tokens = exchange_authorization_code(&client_id, &code, &verifier).await?;
  store_tokens(&tokens)?;
  connected_status(&client_id).await
}

#[tauri::command]
pub fn mal_oauth_logout() -> Result<(), String> {
  delete_tokens()
}

fn map_list_item(media_type: &str, item: &Value) -> Option<MalListItem> {
  let node = item.get("node")?;
  let list_status = item.get("list_status")?;
  let mal_id = node.get("id")?.as_u64()?;
  let title = node.get("title")?.as_str()?.to_string();

  let image_url = node
    .get("main_picture")
    .and_then(|picture| picture.get("large").or_else(|| picture.get("medium")))
    .and_then(Value::as_str)
    .map(str::to_owned);

  let status = list_status
    .get("status")
    .and_then(Value::as_str)
    .unwrap_or_default()
    .to_string();

  let progress = if media_type == "anime" {
    list_status
      .get("num_episodes_watched")
      .and_then(Value::as_u64)
      .unwrap_or(0)
  } else {
    list_status
      .get("num_chapters_read")
      .and_then(Value::as_u64)
      .unwrap_or(0)
  };

  let score = list_status
    .get("score")
    .and_then(Value::as_f64)
    .filter(|score| *score > 0.0);

  let genres = node
    .get("genres")
    .and_then(Value::as_array)
    .map(|genres| {
      genres
        .iter()
        .filter_map(|genre| genre.get("name").and_then(Value::as_str).map(str::to_owned))
        .collect()
    })
    .unwrap_or_default();

  let year = node
    .get("start_date")
    .and_then(Value::as_str)
    .and_then(|date| date.get(..4))
    .and_then(|year| year.parse::<i32>().ok());

  Some(MalListItem {
    media_type: media_type.to_string(),
    mal_id,
    title,
    image_url,
    status,
    progress,
    score,
    updated_at: list_status
      .get("updated_at")
      .and_then(Value::as_str)
      .map(str::to_owned),
    total_episodes: node.get("num_episodes").and_then(Value::as_u64),
    total_chapters: node.get("num_chapters").and_then(Value::as_u64),
    public_score: node.get("mean").and_then(Value::as_f64),
    airing_status: node.get("status").and_then(Value::as_str).map(str::to_owned),
    genres,
    year,
  })
}

#[tauri::command]
pub async fn mal_fetch_user_list(
  client_id: String,
  media_type: String,
) -> Result<Vec<MalListItem>, String> {
  if media_type != "anime" && media_type != "manga" {
    return Err("Tipo MAL inválido.".into());
  }

  let client_id = client_id.trim();
  if client_id.is_empty() {
    return Err("Configure o Client ID do MyAnimeList.".into());
  }

  let tokens = ensure_access_token(client_id).await?;
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .build()
    .map_err(|error| format!("Falha ao preparar cliente MAL: {error}"))?;

  let endpoint = if media_type == "anime" {
    format!("{MAL_API_BASE}/users/@me/animelist")
  } else {
    format!("{MAL_API_BASE}/users/@me/mangalist")
  };

  let fields = if media_type == "anime" {
    "list_status,num_episodes,mean,status,start_date,genres"
  } else {
    "list_status,num_volumes,num_chapters,mean,status,start_date,genres"
  };

  let mut offset = 0_u64;
  let mut result = Vec::new();

  loop {
    let response = client
      .get(&endpoint)
      .query(&[
        ("limit", "100".to_string()),
        ("offset", offset.to_string()),
        ("fields", fields.to_string()),
      ])
      .bearer_auth(&tokens.access_token)
      .send()
      .await
      .map_err(|error| format!("Falha ao baixar lista MAL: {error}"))?;

    if !response.status().is_success() {
      return Err(format!("Lista MAL respondeu HTTP {}.", response.status()));
    }

    let payload = response
      .json::<Value>()
      .await
      .map_err(|error| format!("Lista MAL inválida: {error}"))?;
    let items = payload
      .get("data")
      .and_then(Value::as_array)
      .cloned()
      .unwrap_or_default();

    if items.is_empty() {
      break;
    }

    let page_len = items.len();
    for item in &items {
      if let Some(mapped) = map_list_item(&media_type, item) {
        result.push(mapped);
      }
    }

    let has_next = payload
      .get("paging")
      .and_then(|paging| paging.get("next"))
      .and_then(Value::as_str)
      .is_some();

    if !has_next || page_len < 100 {
      break;
    }

    offset = offset.saturating_add(100);
    if offset > 20_000 {
      return Err("Lista MAL excedeu limite de segurança de paginação.".into());
    }
  }

  Ok(result)
}

#[cfg(test)]
mod tests {
  use super::{build_authorize_url, map_list_item, MAL_REDIRECT_URI};

  #[test]
  fn redirect_uri_is_fixed_loopback() {
    assert_eq!(
      MAL_REDIRECT_URI,
      "http://127.0.0.1:47821/oauth/mal/callback"
    );
  }

  #[test]
  fn authorize_url_uses_plain_pkce_state_and_redirect() {
    let url = build_authorize_url("client-123", "verifier-xyz", "state-abc")
      .expect("authorize url");
    let query = url.query_pairs().collect::<std::collections::HashMap<_, _>>();

    assert_eq!(query.get("response_type").map(|value| value.as_ref()), Some("code"));
    assert_eq!(query.get("client_id").map(|value| value.as_ref()), Some("client-123"));
    assert_eq!(query.get("code_challenge").map(|value| value.as_ref()), Some("verifier-xyz"));
    assert_eq!(query.get("code_challenge_method").map(|value| value.as_ref()), Some("plain"));
    assert_eq!(query.get("state").map(|value| value.as_ref()), Some("state-abc"));
    assert_eq!(
      query.get("redirect_uri").map(|value| value.as_ref()),
      Some(MAL_REDIRECT_URI),
    );
  }

  #[test]
  fn maps_anime_list_item() {
    let raw = serde_json::json!({
      "node": {
        "id": 52991,
        "title": "Sousou no Frieren",
        "num_episodes": 28,
        "mean": 9.1,
        "status": "finished_airing",
        "start_date": "2023-09-29",
        "genres": [{"id": 1, "name": "Adventure"}],
        "main_picture": {"large": "https://example.test/f.jpg"}
      },
      "list_status": {
        "status": "completed",
        "score": 10,
        "num_episodes_watched": 28,
        "updated_at": "2026-10-06T00:00:00+00:00"
      }
    });

    let item = map_list_item("anime", &raw).expect("anime mapped");
    assert_eq!(item.mal_id, 52991);
    assert_eq!(item.progress, 28);
    assert_eq!(item.status, "completed");
    assert_eq!(item.genres, vec!["Adventure".to_string()]);
  }

  #[test]
  fn maps_manga_list_item() {
    let raw = serde_json::json!({
      "node": {
        "id": 2,
        "title": "Berserk",
        "num_chapters": 380,
        "mean": 9.4,
        "status": "currently_publishing",
        "start_date": "1989-08-25",
        "genres": [{"id": 8, "name": "Drama"}]
      },
      "list_status": {
        "status": "reading",
        "score": 9,
        "num_chapters_read": 120,
        "updated_at": "2026-10-06T00:00:00+00:00"
      }
    });

    let item = map_list_item("manga", &raw).expect("manga mapped");
    assert_eq!(item.mal_id, 2);
    assert_eq!(item.progress, 120);
    assert_eq!(item.status, "reading");
    assert_eq!(item.total_chapters, Some(380));
  }
}
