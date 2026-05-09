use serde::Serialize;
use serde_json::{Map, Number, Value as JsonValue};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row, Sqlite, SqlitePool, TypeInfo, ValueRef};
use std::fs::create_dir_all;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct SqlBridgeState {
    pool: Mutex<Option<SqlitePool>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    rows_affected: u64,
    last_insert_id: Option<i64>,
}

fn db_path<R: Runtime>(app: &AppHandle<R>, db: &str) -> Result<std::path::PathBuf, String> {
    let relative = db
        .strip_prefix("sqlite:")
        .ok_or_else(|| format!("unsupported database URL: {db}"))?;
    if relative.contains("..") {
        return Err("database path must not contain '..'".to_string());
    }

    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    create_dir_all(&path).map_err(|e| e.to_string())?;
    path.push(relative);
    Ok(path)
}

async fn open_pool<R: Runtime>(app: &AppHandle<R>, db: &str) -> Result<SqlitePool, String> {
    let path = db_path(app, db)?;
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    SqlitePoolOptions::new()
        // All SQL calls from the webview are already serialized in
        // TypeScript. Keeping the Rust pool at one connection ensures
        // BEGIN/body/COMMIT commands stay on the same SQLite handle.
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| e.to_string())
}

async fn ensure_pool<R: Runtime>(
    app: &AppHandle<R>,
    state: &SqlBridgeState,
    db: &str,
) -> Result<SqlitePool, String> {
    let mut guard = state.pool.lock().await;
    if let Some(pool) = guard.as_ref() {
        return Ok(pool.clone());
    }

    let pool = open_pool(app, db).await?;
    *guard = Some(pool.clone());
    Ok(pool)
}

fn bind_json<'q>(
    mut query: sqlx::query::Query<'q, Sqlite, <Sqlite as sqlx::Database>::Arguments<'q>>,
    values: Vec<JsonValue>,
) -> sqlx::query::Query<'q, Sqlite, <Sqlite as sqlx::Database>::Arguments<'q>> {
    for value in values {
        query = match value {
            JsonValue::Null => query.bind(Option::<String>::None),
            JsonValue::Bool(v) => query.bind(v),
            JsonValue::Number(n) => {
                if let Some(v) = n.as_i64() {
                    query.bind(v)
                } else if let Some(v) = n.as_u64() {
                    if v <= i64::MAX as u64 {
                        query.bind(v as i64)
                    } else {
                        query.bind(v as f64)
                    }
                } else if let Some(v) = n.as_f64() {
                    query.bind(v)
                } else {
                    query.bind(n.to_string())
                }
            }
            JsonValue::String(v) => query.bind(v),
            other => query.bind(other.to_string()),
        };
    }
    query
}

fn number_from_f64(v: f64) -> JsonValue {
    Number::from_f64(v).map_or(JsonValue::Null, JsonValue::Number)
}

fn decode_value(row: &SqliteRow, idx: usize) -> Result<JsonValue, sqlx::Error> {
    let raw = row.try_get_raw(idx)?;
    if raw.is_null() {
        return Ok(JsonValue::Null);
    }

    match raw.type_info().name().to_ascii_uppercase().as_str() {
        "TEXT" => Ok(JsonValue::String(row.try_get::<String, _>(idx)?)),
        "INTEGER" => Ok(JsonValue::Number(Number::from(row.try_get::<i64, _>(idx)?))),
        "REAL" | "FLOAT" | "DOUBLE" => Ok(number_from_f64(row.try_get::<f64, _>(idx)?)),
        "BOOLEAN" | "BOOL" => Ok(JsonValue::Bool(row.try_get::<bool, _>(idx)?)),
        "BLOB" => {
            let bytes = row.try_get::<Vec<u8>, _>(idx)?;
            Ok(JsonValue::Array(
                bytes
                    .into_iter()
                    .map(|b| JsonValue::Number(Number::from(b)))
                    .collect(),
            ))
        }
        _ => {
            if let Ok(v) = row.try_get::<i64, _>(idx) {
                return Ok(JsonValue::Number(Number::from(v)));
            }
            if let Ok(v) = row.try_get::<f64, _>(idx) {
                return Ok(number_from_f64(v));
            }
            if let Ok(v) = row.try_get::<String, _>(idx) {
                return Ok(JsonValue::String(v));
            }
            Ok(JsonValue::Null)
        }
    }
}

#[tauri::command]
pub async fn sql_load<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SqlBridgeState>,
    db: String,
) -> Result<String, String> {
    ensure_pool(&app, &state, &db).await?;
    Ok(db)
}

#[tauri::command]
pub async fn sql_execute<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SqlBridgeState>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<ExecuteResult, String> {
    let pool = ensure_pool(&app, &state, &db).await?;
    let result = bind_json(sqlx::query(&query), values)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ExecuteResult {
        rows_affected: result.rows_affected(),
        last_insert_id: Some(result.last_insert_rowid()),
    })
}

#[tauri::command]
pub async fn sql_select<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SqlBridgeState>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<Vec<Map<String, JsonValue>>, String> {
    let pool = ensure_pool(&app, &state, &db).await?;
    let rows = bind_json(sqlx::query(&query), values)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let mut mapped = Map::new();
        for (i, column) in row.columns().iter().enumerate() {
            let value = decode_value(&row, i).map_err(|e| e.to_string())?;
            mapped.insert(column.name().to_string(), value);
        }
        out.push(mapped);
    }
    Ok(out)
}

#[tauri::command]
pub async fn sql_close(state: State<'_, SqlBridgeState>) -> Result<bool, String> {
    let mut guard = state.pool.lock().await;
    if let Some(pool) = guard.take() {
        pool.close().await;
    }
    Ok(true)
}
