//! MCP JSON-RPC, shared by newline-delimited stdio and stateless Streamable HTTP.
use crate::{
    schema,
    service::{required, Service},
};
use serde_json::{json, Value};
use std::sync::Arc;

fn text() -> Value {
    json!({"type":"string","minLength":1,"maxLength":500})
}
fn identifier() -> Value {
    json!({"type":"string","pattern":"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$"})
}
fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn strict_data(properties: Value) -> Value {
    let required = properties
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    object(properties.clone(), &required)
}
fn output_schema(name: &str) -> Value {
    let array = json!({"type":"array"});
    let obj = json!({"type":"object"});
    let nullable = json!({"type":["object","null"]});
    let string = json!({"type":"string"});
    let num = json!({"type":"number"});
    let data = match name {
        "forgepad_list_roadmaps" => strict_data(json!({"roadmaps":array})),
        "forgepad_get_roadmap_progress" => strict_data(
            json!({"roadmap_id":string,"total":num,"solved":num,"mastered":num,"completion_percent":num,"active_topics":array,"mastery_rule":string}),
        ),
        "forgepad_get_next_question" => strict_data(
            json!({"roadmap_id":string,"question":obj,"reason":string,"deep_link":string}),
        ),
        "forgepad_open_question" => strict_data(
            json!({"question":obj,"deep_link":string,"navigation_requested":{"type":"boolean"}}),
        ),
        "forgepad_start_practice" | "forgepad_start_mock_interview" => {
            strict_data(json!({"session":obj}))
        }
        "forgepad_get_active_session" => strict_data(json!({"session":nullable})),
        "forgepad_get_session_summary" => strict_data(
            json!({"session_id":string,"state":string,"report":nullable,"test_outcomes":array,"deep_link":string}),
        ),
        "forgepad_search_questions" => strict_data(json!({"questions":array})),
        "forgepad_get_question" => strict_data(json!({"question":obj})),
        "forgepad_get_working_draft" | "forgepad_save_working_draft" => {
            strict_data(json!({"draft":obj}))
        }
        "forgepad_run_tests" | "forgepad_get_run" => strict_data(json!({"run":obj})),
        "forgepad_control_session" => strict_data(json!({"session":obj})),
        "forgepad_get_hint" => strict_data(
            json!({"hint":string,"index":{"type":"integer"},"total":{"type":"integer"}}),
        ),
        "forgepad_get_authoring_prompt" => strict_data(json!({"prompt":string})),
        "forgepad_create_question_draft" => strict_data(
            json!({"draft_id":string,"status":string,"generation_job":nullable,"published":{"const":false}}),
        ),
        "forgepad_import_question" => strict_data(
            json!({"draft_id":string,"status":string,"validation_job_id":string,"schema_errors":array,"published":{"const":false}}),
        ),
        "forgepad_audit_question" => strict_data(json!({"audit_id":string,"status":string})),
        "forgepad_get_question_audit" => strict_data(
            json!({"audit_id":string,"status":string,"question_id":string,"question_version":{"type":["integer","null"]},"findings":array,"reference_execution_status":{"type":["string","null"]},"approval_required":{"const":true}}),
        ),
        "forgepad_get_weak_topics" => {
            strict_data(json!({"topics":array,"assessment_basis":string}))
        }
        "forgepad_get_due_reviews" => strict_data(json!({"reviews":array})),
        "forgepad_add_practice_task" => strict_data(json!({"task":obj})),
        "forgepad_record_reflection" => strict_data(
            json!({"reflection_id":string,"session_id":string,"recorded":{"const":true}}),
        ),
        "forgepad_get_preparation_status" => strict_data(
            json!({"active_roadmap":string,"current_topic":{"type":["string","null"]},"next_required_question":nullable,"last_completed_question":nullable,"recent_weak_areas":array,"due_reviews":array,"unfinished_tasks":array,"current_interview":nullable,"summary":obj}),
        ),
        _ => unreachable!(),
    };
    object(json!({"ok":{"const":true},"data":data}), &["ok", "data"])
}
fn tool(name: &str, description: &str, input: Value, read_only: bool) -> Value {
    json!({"name":name,"description":description,"inputSchema":input,
        "outputSchema":output_schema(name),
        "annotations":{"readOnlyHint":read_only,"destructiveHint":false,"idempotentHint":read_only,"openWorldHint":false}})
}
pub fn tools() -> Vec<Value> {
    let none = object(json!({}), &[]);
    let roadmap = object(json!({"roadmap_id":identifier()}), &["roadmap_id"]);
    let question = object(json!({"question_id":identifier()}), &["question_id"]);
    let working = object(
        json!({"question_id":identifier(),"session_id":identifier(),"question_version":{"type":"integer","minimum":1}}),
        &["question_id"],
    );
    let practice = object(
        json!({"question_id":identifier(),"roadmap_id":identifier(),"topic":text(),"type":{"enum":["coding","theory","debugging","design","code_review"]},"difficulty":{"enum":["beginner","intermediate","advanced","expert"]},"duration_minutes":{"type":"integer","minimum":1,"maximum":240}}),
        &[],
    );
    vec![
        tool("forgepad_list_roadmaps","List local preparation roadmaps.",none.clone(),true),
        tool("forgepad_get_roadmap_progress","Retrieve deterministic solved/mastered counts and active topics. Self-reported theory confidence is separate from test correctness.",roadmap.clone(),true),
        tool("forgepad_get_next_question","Select a question using roadmap order and due reviews. Returns candidate-safe metadata.",roadmap,true),
        tool("forgepad_open_question","Open an existing question in ForgePad; no protected grading material is returned.",question.clone(),false),
        tool("forgepad_start_practice","Start a real practice session. Fails if another session is active.",practice.clone(),false),
        tool("forgepad_start_mock_interview","Start a timed strict interview. Do not offer hints or solutions.",practice,false),
        tool("forgepad_get_active_session","Retrieve fresh active-session metadata and remaining time, excluding transcript and code.",none.clone(),true),
        tool("forgepad_get_session_summary","Retrieve a compact recorded report and actual deterministic outcomes. Unassessed dimensions remain ungraded.",object(json!({"session_id":identifier()}),&["session_id"]),true),
        tool("forgepad_search_questions","Search the local question library; metadata only.",object(json!({"q":text(),"topic":text(),"type":{"enum":["coding","theory","debugging","design","code_review"]},"difficulty":{"enum":["beginner","intermediate","advanced","expert"]},"limit":{"type":"integer","minimum":1,"maximum":50}}),&[]),true),
        tool("forgepad_get_question","Read the public prompt, constraints, starter files, rubric and all visible tests for a question. Strict interview hints stay hidden.",working.clone(),true),
        tool("forgepad_get_working_draft","Read the candidate's saved source and written response for a question revision. Does not return a reference answer.",working.clone(),true),
        tool("forgepad_save_working_draft","Save candidate source and written response for an explicit question. Send the full draft and the updated_at from get_working_draft; a stale write is rejected. Does not submit or mark solved.",object(json!({"question_id":identifier(),"session_id":identifier(),"question_version":{"type":"integer","minimum":1},"updated_at":{"type":["string","null"]},"files":{"type":"object","maxProperties":20,"additionalProperties":{"type":"string","maxLength":262144}},"answer":{"type":"string","maxLength":50000}}),&["question_id","updated_at","files","answer"]),false),
        tool("forgepad_run_tests","Run the complete visible test suite on the saved working draft, using the restricted compiler sandbox. This does not submit or record an attempt. Poll get_run for the actual result.",working.clone(),false),
        tool("forgepad_get_run","Read a queued run or actual complete-suite test results by run ID.",object(json!({"run_id":identifier()}),&["run_id"]),true),
        tool("forgepad_control_session","Pause, resume or advance a specific active session. Returns confirmed session metadata.",object(json!({"session_id":identifier(),"action":{"enum":["pause","resume","advance"]}}),&["session_id","action"]),false),
        tool("forgepad_get_hint","Read one prepared practice hint by zero-based index. Unavailable during strict interviews.",object(json!({"question_id":identifier(),"session_id":identifier(),"question_version":{"type":"integer","minimum":1},"index":{"type":"integer","minimum":0,"maximum":100}}),&["question_id","index"]),true),
        tool("forgepad_get_authoring_prompt","Get the exact question schema and authoring requirements before creating/importing a question. Requires complete starter/reference files, independently justified expected outputs, and 8–30 visible tests including edge cases. No generation or publication.",object(json!({"idea":{"type":"string","minLength":1,"maxLength":5000}}),&["idea"]),true),
        tool("forgepad_create_question_draft","Save an unpublished idea; queue local generation if configured. Never publishes or claims that a generated package is valid.",object(json!({"idea":{"type":"string","minLength":1,"maxLength":5000}}),&["idea"]),false),
        tool("forgepad_import_question","Stage a structured JSON package for asynchronous validation and human review. Returns no publication capability.",object(json!({"question":{"type":"object"}}),&["question"]),false),
        tool("forgepad_audit_question","Queue structural and sandbox checks for an existing question. Does not alter published tests.",question,false),
        tool("forgepad_get_question_audit","Get a safe audit summary; reference solution sources are excluded.",object(json!({"audit_id":identifier()}),&["audit_id"]),true),
        tool("forgepad_get_weak_topics","Return repeated recorded failures or self-reported uncertainty with evidence IDs; these are not inferred conceptual diagnoses.",none.clone(),true),
        tool("forgepad_get_due_reviews","Retrieve due spaced reviews from the authoritative database.",none.clone(),true),
        tool("forgepad_add_practice_task","Add an unpublished preparation task.",object(json!({"title":text()}),&["title"]),false),
        tool("forgepad_record_reflection","Save a reflection with an explicitly resolved session target.",object(json!({"session_id":identifier(),"reflection":{"type":"string","minLength":1,"maxLength":10000}}),&["session_id","reflection"]),false),
        tool("forgepad_get_preparation_status","Get compact fresh preparation context without source files, audio or transcript histories.",none,true),
    ]
}
fn error(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}
pub async fn rpc(service: Arc<Service>, request: Value) -> Option<Value> {
    let id = request.get("id").cloned();
    if request["jsonrpc"] != "2.0"
        || !request["method"].is_string()
        || id
            .as_ref()
            .is_some_and(|id| !id.is_string() && !id.is_number())
    {
        return Some(error(
            id.unwrap_or(Value::Null),
            -32600,
            "Invalid JSON-RPC request",
        ));
    }
    let id = id?;
    if !*service.mcp_enabled.lock().unwrap() {
        return Some(error(id,-32001,"ForgePad access is disconnected. Enable HeyClicky in ForgePad Settings → Integrations."));
    }
    let method = request["method"].as_str().unwrap();
    let result = match method {
        "initialize" => {
            if !request["params"]["protocolVersion"].is_string()
                || !request["params"]["clientInfo"].is_object()
                || !request["params"]["capabilities"].is_object()
            {
                return Some(error(
                    id,
                    -32602,
                    "Initialization requires protocolVersion, clientInfo and capabilities",
                ));
            }
            let requested = request["params"]["protocolVersion"].as_str().unwrap();
            json!({"protocolVersion":if ["2025-11-25","2025-06-18","2025-03-26","2024-11-05"].contains(&requested){requested}else{"2025-11-25"},"capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"ForgePad","version":env!("CARGO_PKG_VERSION")},"instructions":"ForgePad owns progress and grading. Retrieve fresh state, require stable target IDs and report success only after backend confirmation. Protected grading material is unavailable. Publishing and deletion require the ForgePad UI."})
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools":tools()}),
        "tools/call" => {
            let name = request["params"]["name"].as_str().unwrap_or("");
            let Some(tool) = tools().into_iter().find(|t| t["name"] == name) else {
                return Some(error(id, -32602, "Unknown or disallowed tool"));
            };
            let args = request["params"]
                .get("arguments")
                .cloned()
                .unwrap_or(json!({}));
            let validator = jsonschema::validator_for(&tool["inputSchema"]).unwrap();
            if let Some(e) = validator.iter_errors(&args).next() {
                return Some(error(
                    id,
                    -32602,
                    &format!("Invalid arguments at {}: {}", e.instance_path, e),
                ));
            }
            let result = call(&service, name, args).await;
            let success = result.is_ok();
            let _ = service.log_action(
                name,
                success,
                if success {
                    "Confirmed backend result"
                } else {
                    "Operation failed; no success claimed"
                },
            );
            match result {
                Ok(data) => {
                    let content = json!({"ok":true,"data":data});
                    if !jsonschema::is_valid(&tool["outputSchema"], &content) {
                        return Some(error(
                            id,
                            -32603,
                            "Backend returned an invalid structured response",
                        ));
                    }
                    json!({"content":[{"type":"text","text":content.to_string()}],"structuredContent":content,"isError":false})
                }
                Err(e) => json!({"content":[{"type":"text","text":e.to_string()}],"isError":true}),
            }
        }
        _ => return Some(error(id, -32601, "Method not found")),
    };
    Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
}
async fn call(s: &Arc<Service>, name: &str, a: Value) -> anyhow::Result<Value> {
    Ok(match name {
        "forgepad_get_question"
        | "forgepad_get_working_draft"
        | "forgepad_save_working_draft"
        | "forgepad_run_tests"
        | "forgepad_get_hint" => {
            let id = required(&a, "question_id")?;
            let q = if a["session_id"].is_string() {
                s.question_for_request(id, a["session_id"].as_str())?
            } else {
                s.store.question(id, a["question_version"].as_i64())?
            };
            match name {
                "forgepad_get_question" => {
                    let mut question = schema::candidate(&q);
                    if s.active_session()?["strict"] == true {
                        question["hints"] = json!([]);
                    }
                    json!({"question":question})
                }
                "forgepad_get_working_draft" => json!({"draft":s.store.draft(&q)?}),
                "forgepad_save_working_draft" => {
                    let draft = s.store.save_draft_if_current(&q, &a)?;
                    s.notify(
                        "draft_updated",
                        json!({"question_id":id,"version":q["version"]}),
                    );
                    json!({"draft":draft})
                }
                "forgepad_run_tests" => {
                    let draft = s.store.draft(&q)?;
                    json!({"run":s.enqueue_run(&json!({"question_id":id,"question_version":q["version"],"session_id":a["session_id"],"files":draft["files"],"mode":"run"}))?})
                }
                _ => {
                    anyhow::ensure!(
                        s.active_session()?["strict"] != true,
                        "Hints are unavailable during strict interviews"
                    );
                    let index = a["index"].as_u64().unwrap() as usize;
                    let hint = q["hints"][index]
                        .as_str()
                        .ok_or_else(|| anyhow::anyhow!("No hint at this index"))?;
                    s.store.event(
                        a["session_id"].as_str(),
                        "hint_request",
                        json!({"question_id":id,"hint_index":index}),
                    )?;
                    json!({"hint":hint,"index":index,"total":q["hints"].as_array().map_or(0,Vec::len)})
                }
            }
        }
        "forgepad_get_run" => json!({"run":s.store.get("runs",required(&a,"run_id")?)?}),
        "forgepad_get_authoring_prompt" => {
            json!({"prompt":schema::authoring_prompt(required(&a,"idea")?,&json!({}))})
        }
        "forgepad_control_session" => {
            let id = required(&a, "session_id")?;
            let result = s.session_event(id, &json!({"type":a["action"]}))?;
            json!({"session":Service::session_metadata(&result)})
        }
        "forgepad_list_roadmaps" => {
            json!({"roadmaps":s.roadmaps()?.iter().map(|r|json!({"id":r["id"],"title":r["title"],"total":r["total"]})).collect::<Vec<_>>()})
        }
        "forgepad_get_roadmap_progress" => {
            let r = s.roadmap(required(&a, "roadmap_id")?)?;
            json!({"roadmap_id":r["id"],"total":r["total"],"solved":r["solved"],"mastered":r["mastered"],"completion_percent":r["completion_percent"],"active_topics":r["active_topics"],"mastery_rule":r["mastery_rule"]})
        }
        "forgepad_get_next_question" => s.next_question(required(&a, "roadmap_id")?, &json!({}))?,
        "forgepad_open_question" => {
            let q = s.store.question(required(&a, "question_id")?, None)?;
            let link = format!("forgepad://question/{}", q["id"].as_str().unwrap());
            s.notify("navigate", schema::deep_link(&link)?);
            json!({"question":s.summary(&q)?,"deep_link":link,"navigation_requested":true})
        }
        "forgepad_start_practice" | "forgepad_start_mock_interview" => {
            let session = s.start_session(
                &a,
                if name == "forgepad_start_practice" {
                    "practice"
                } else {
                    "interview"
                },
            )?;
            s.notify(
                "navigate",
                schema::deep_link(&format!(
                    "forgepad://interview/{}",
                    session["id"].as_str().unwrap()
                ))?,
            );
            json!({"session":Service::session_metadata(&session)})
        }
        "forgepad_get_active_session" => json!({"session":s.active_session()?}),
        "forgepad_get_session_summary" => {
            let session = s.load_session(required(&a, "session_id")?)?;
            let outcomes=s.store.replay(required(&a,"session_id")?)?.iter().filter(|e|e["kind"]=="test_result").map(|e|json!({"run_id":e["data"]["run_id"],"status":e["data"]["result"]["status"],"passed":e["data"]["result"]["passed"],"total":e["data"]["result"]["total"]})).collect::<Vec<_>>();
            json!({"session_id":session["id"],"state":session["state"],"report":session["report"],"test_outcomes":outcomes,"deep_link":format!("forgepad://report/{}",session["id"].as_str().unwrap())})
        }
        "forgepad_search_questions" => {
            let mut qs = s.questions(&a)?;
            qs.truncate(a["limit"].as_u64().unwrap_or(20) as usize);
            json!({"questions":qs})
        }
        "forgepad_create_question_draft" => {
            let d = s.stage(Value::Null, Some(required(&a, "idea")?), "heyclicky")?;
            let job = if s.models.list().is_empty() {
                None
            } else {
                Some(s.enqueue_job("generate", d["id"].as_str().unwrap(), json!({}))?)
            };
            json!({"draft_id":d["id"],"status":d["status"],"generation_job":job,"published":false})
        }
        "forgepad_import_question" => {
            let d = s.stage(a["question"].clone(), None, "heyclicky")?;
            let job = s.enqueue_job("validate", d["id"].as_str().unwrap(), json!({}))?;
            json!({"draft_id":d["id"],"status":d["status"],"validation_job_id":job["id"],"schema_errors":d["errors"],"published":false})
        }
        "forgepad_audit_question" => {
            let id = required(&a, "question_id")?;
            s.store.question(id, None)?;
            let job = s.enqueue_job("audit", id, json!({}))?;
            json!({"audit_id":job["id"],"status":job["status"]})
        }
        "forgepad_get_question_audit" => {
            let job = s.store.get("jobs", required(&a, "audit_id")?)?;
            anyhow::ensure!(job["kind"] == "audit", "The target is not a question audit");
            let r = &job["result"];
            let findings=r["findings"].as_array().into_iter().flatten().map(|f|json!({"code":f["code"],"severity":f["severity"],"classification":f["classification"],"suggestion":f["suggestion"]})).collect::<Vec<_>>();
            json!({"audit_id":job["id"],"status":job["status"],"question_id":job["target_id"],"question_version":r["question_version"],"findings":findings,"reference_execution_status":r["reference_execution"]["status"],"approval_required":true})
        }
        "forgepad_get_weak_topics" => {
            json!({"topics":s.compact_progress()?["weak_topics"],"assessment_basis":"Recorded unsuccessful tests or self-reported uncertainty; not a conceptual diagnosis"})
        }
        "forgepad_get_due_reviews" => json!({"reviews":s.compact_progress()?["due_reviews"]}),
        "forgepad_add_practice_task" => {
            let task = json!({"id":crate::id(),"title":required(&a,"title")?,"status":"pending","created_at":crate::now()});
            s.store.save("goals", &task)?;
            json!({"task":task})
        }
        "forgepad_record_reflection" => {
            let session = s.load_session(required(&a, "session_id")?)?;
            let record = json!({"id":crate::id(),"session_id":session["id"],"reflection":a["reflection"],"created_at":crate::now()});
            s.store.save("reflections", &record)?;
            json!({"reflection_id":record["id"],"session_id":session["id"],"recorded":true})
        }
        "forgepad_get_preparation_status" => s.preparation_context()?,
        _ => anyhow::bail!("Disallowed tool"),
    })
}
