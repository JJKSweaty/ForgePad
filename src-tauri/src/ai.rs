//! One bounded inference lane, with interactive work preempting background generation.
use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tokio::sync::{broadcast, Semaphore};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Model {
    pub id: String,
    pub endpoint: String,
    pub model: String,
    pub memory_mb: u64,
    pub context_tokens: u32,
    #[serde(default = "default_output")]
    pub output_tokens: u32,
}
fn default_output() -> u32 {
    2048
}
pub fn validate_models(models: &[Model]) -> Result<()> {
    if models.len() > 8 {
        bail!("At most eight configured providers are supported");
    }
    let mut ids = std::collections::HashSet::new();
    for m in models {
        let url = url::Url::parse(&m.endpoint)?;
        if url.scheme() != "http"
            || ![Some("localhost"), Some("127.0.0.1"), Some("[::1]")].contains(&url.host_str())
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            bail!("Inference endpoints must be credential-free loopback HTTP URLs");
        }
        if !ids.insert(&m.id)
            || m.id.is_empty()
            || m.id.len() > 80
            || m.model.len() > 200
            || !(512..=32768).contains(&m.context_tokens)
            || !(64..=8192).contains(&m.output_tokens)
            || m.output_tokens >= m.context_tokens
            || !(128..=131072).contains(&m.memory_mb)
        {
            bail!("Invalid model ID, memory estimate, or bounded context/output budget");
        }
    }
    Ok(())
}

pub struct Models {
    models: Mutex<Vec<Model>>,
    lane: Arc<Semaphore>,
    background: Mutex<Option<CancellationToken>>,
    foreground: AtomicUsize,
    pub diagnostics: Mutex<Vec<Value>>,
    pub events: broadcast::Sender<Value>,
}
impl Models {
    pub fn new(events: broadcast::Sender<Value>) -> Self {
        Self {
            models: Mutex::new(vec![]),
            lane: Arc::new(Semaphore::new(1)),
            background: Mutex::new(None),
            foreground: AtomicUsize::new(0),
            diagnostics: Mutex::new(vec![]),
            events,
        }
    }
    pub fn configure(&self, models: Vec<Model>) -> Result<()> {
        validate_models(&models)?;
        *self.models.lock().unwrap() = models;
        Ok(())
    }
    pub fn list(&self) -> Vec<Model> {
        self.models.lock().unwrap().clone()
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn generate(
        &self,
        job: &str,
        system: &str,
        mut context: Value,
        interactive: bool,
        structured: bool,
        cancel: CancellationToken,
    ) -> Result<String> {
        let selected = context
            .as_object_mut()
            .and_then(|o| o.remove("_benchmark_model"))
            .and_then(|v| v.as_str().map(str::to_string));
        let models = self
            .list()
            .into_iter()
            .filter(|m| selected.as_ref().is_none_or(|id| id == &m.id))
            .collect::<Vec<_>>();
        if models.is_empty() {
            bail!("Local inference is disabled. Configure a llama.cpp endpoint in Settings; structured JSON import works without AI.");
        }
        let _priority = if interactive {
            self.foreground.fetch_add(1, Ordering::SeqCst);
            Some(Foreground(&self.foreground))
        } else {
            None
        };
        if interactive {
            if let Some(token) = self.background.lock().unwrap().take() {
                token.cancel();
            }
        }
        let _permit = loop {
            let permit = tokio::select! {p=self.lane.acquire()=>p?,_=cancel.cancelled()=>bail!("Inference cancelled")};
            if interactive || self.foreground.load(Ordering::SeqCst) == 0 {
                break permit;
            }
            drop(permit);
            tokio::select! {_=tokio::time::sleep(std::time::Duration::from_millis(10))=>{},_=cancel.cancelled()=>bail!("Inference cancelled")};
        };
        if !interactive {
            *self.background.lock().unwrap() = Some(cancel.clone());
        }
        let memory = available_memory_mb()
            .await
            .context("Available memory could not be measured; inference was not started")?;
        let mut last = String::from("No configured model fits available memory");
        for model in models {
            if model.memory_mb + 1024 > memory {
                continue;
            }
            // Conservative UTF-8 byte budget: never split a JSON context midway.
            let content = context.to_string();
            if content.len() + system.len() > (model.context_tokens - model.output_tokens) as usize
            {
                last = "Context exceeds the selected model's conservative token budget. Reduce context or select a larger window.".into();
                continue;
            }
            let started = Instant::now();
            let result = self
                .stream(job, &model, system, &content, structured, cancel.clone())
                .await;
            let diagnostic = json!({"job_id":job,"model":model.id,"elapsed_ms":started.elapsed().as_millis(),"available_memory_mb":memory,"success":result.is_ok(),"at":crate::now()});
            {
                let mut d = self.diagnostics.lock().unwrap();
                d.push(diagnostic);
                if d.len() > 100 {
                    d.remove(0);
                }
            }
            match result {
                Ok(s) => return Ok(s),
                Err(e) => {
                    last = e.to_string();
                    if cancel.is_cancelled() {
                        break;
                    }
                }
            }
        }
        bail!("{last}")
    }
    pub async fn benchmark_all(&self, cancel: CancellationToken) -> Result<Value> {
        let models = self.list();
        if models.is_empty() {
            bail!("Configure at least one local model before benchmarking");
        }
        let mut results = vec![];
        for model in models {
            let started = Instant::now();
            let result=self.generate(&crate::id(),"Return concise firmware facts.",json!({"_benchmark_model":model.id,"request":"Explain unsigned timer wraparound in two sentences."}),false,false,cancel.clone()).await;
            results.push(json!({"model_id":model.id,"elapsed_ms":started.elapsed().as_millis(),"success":result.is_ok(),"error":result.err().map(|e|e.to_string())}));
            if cancel.is_cancelled() {
                bail!("Benchmark cancelled");
            }
        }
        Ok(
            json!({"models":results,"diagnostics":self.diagnostics.lock().unwrap().clone(),"note":"Sequential measurements of configured persistent runtimes; no model was downloaded or implicitly loaded."}),
        )
    }
    pub async fn availability(&self) -> Value {
        let models = self.list();
        if models.is_empty() {
            return json!({"available":false,"detail":"Local inference is disabled; all practice workflows remain usable."});
        }
        let check = async move {
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(2))
                .build()
                .ok()?;
            let requests = models.into_iter().map(|m| {
                let client = client.clone();
                async move {
                    let r = client
                        .get(format!("{}/v1/models", m.endpoint.trim_end_matches('/')))
                        .send()
                        .await
                        .ok()?
                        .error_for_status()
                        .ok()?;
                    let v: Value = r.json().await.ok()?;
                    if v["data"]
                        .as_array()?
                        .iter()
                        .any(|item| item["id"] == m.model)
                    {
                        Some(m.id.clone())
                    } else {
                        None
                    }
                }
            });
            let mut pending = futures_util::stream::iter(requests).buffer_unordered(2);
            while let Some(result) = pending.next().await {
                if result.is_some() {
                    return result;
                }
            }
            None
        };
        match tokio::time::timeout(std::time::Duration::from_secs(2), check)
            .await
            .ok()
            .flatten()
        {
            Some(id) => {
                json!({"available":true,"model":id,"detail":"Configured local model was discovered in the runtime."})
            }
            None => {
                json!({"available":false,"detail":"Configured local runtimes are unreachable or do not list the selected model. Inference requests will report their actual result."})
            }
        }
    }
    async fn stream(
        &self,
        job: &str,
        model: &Model,
        system: &str,
        context: &str,
        structured: bool,
        cancel: CancellationToken,
    ) -> Result<String> {
        let started = Instant::now();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(240))
            .build()?;
        let mut payload = json!({"model":model.model,"messages":[{"role":"system","content":system},{"role":"user","content":context}],"stream":true,"max_tokens":model.output_tokens,"temperature":0.2,"stream_options":{"include_usage":true}});
        if structured {
            payload["response_format"] = json!({"type":"json_object"});
        }
        let response = tokio::select! {
            r = client.post(format!("{}/v1/chat/completions",model.endpoint.trim_end_matches('/'))).json(&payload).send() => r?.error_for_status()?,
            _ = cancel.cancelled() => bail!("Inference cancelled")
        };
        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        let mut output = String::new();
        let mut first = None;
        let mut tokens = 0;
        loop {
            let chunk = tokio::select! { chunk = stream.next() => chunk, _ = cancel.cancelled() => bail!("Inference cancelled") };
            let Some(chunk) = chunk else {
                break;
            };
            buffer.extend_from_slice(&chunk?);
            if buffer.len() > 256 * 1024 {
                bail!("Provider stream exceeded frame limit");
            }
            while let Some(end) = buffer.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=end).collect();
                let line = std::str::from_utf8(&line)?.trim();
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                if data.trim() == "[DONE]" {
                    continue;
                }
                let v: Value = serde_json::from_str(data.trim())?;
                if let Some(n) = v["usage"]["completion_tokens"].as_u64() {
                    tokens = n;
                }
                if let Some(text) = v["choices"][0]["delta"]["content"].as_str() {
                    if !text.is_empty() {
                        first.get_or_insert(started.elapsed().as_millis());
                    }
                    output.push_str(text);
                    if output.len() > 256 * 1024 {
                        bail!("Model output exceeded 256 KiB");
                    }
                    let _ = self
                        .events
                        .send(json!({"type":"inference_delta","job_id":job,"text":text}));
                }
            }
        }
        if output.trim().is_empty() {
            bail!("Provider returned no content");
        }
        if structured {
            serde_json::from_str::<Value>(&output)
                .context("Provider did not return valid structured JSON")?;
        }
        let elapsed = started.elapsed().as_secs_f64();
        {
            let mut d = self.diagnostics.lock().unwrap();
            d.push(json!({"job_id":job,"model":model.id,"ttft_ms":first,"tokens":tokens,"tokens_per_second":if tokens>0&&elapsed>0.0{Some(tokens as f64/elapsed)}else{None},"elapsed_ms":started.elapsed().as_millis(),"at":crate::now()}));
            if d.len() > 100 {
                d.remove(0);
            }
        }

        let _ = self.events.send(json!({"type":"inference_complete","job_id":job,"ttft_ms":first,"tokens":tokens,"tokens_per_second":if tokens>0 && elapsed>0.0 {Some(tokens as f64/elapsed)} else {None}}));
        Ok(output)
    }
}

struct Foreground<'a>(&'a AtomicUsize);
impl Drop for Foreground<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

pub async fn available_memory_mb() -> Option<u64> {
    let output = tokio::process::Command::new("/usr/bin/vm_stat")
        .output()
        .await
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let page_size = text
        .lines()
        .next()?
        .split("page size of ")
        .nth(1)?
        .split(' ')
        .next()?
        .parse::<u64>()
        .ok()?;
    let mut pages = 0;
    for line in text.lines() {
        if ["Pages free:", "Pages inactive:", "Pages speculative:"]
            .iter()
            .any(|prefix| line.starts_with(prefix))
        {
            pages += line
                .split(':')
                .nth(1)?
                .trim()
                .trim_end_matches('.')
                .parse::<u64>()
                .ok()?;
        }
    }
    Some(pages * page_size / (1024 * 1024))
}
