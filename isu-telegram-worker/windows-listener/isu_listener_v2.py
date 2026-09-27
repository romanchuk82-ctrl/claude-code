import asyncio
import base64
import http.client
import json
import logging
import logging.handlers
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

QUEUE_ROOT = Path(r"C:\Users\test\Downloads\ISU-Judge-Telegram-Inbox\queue")
STATE_FILE = QUEUE_ROOT.parent / "last_seen.txt"
LOG_FILE = QUEUE_ROOT.parent / "isu-listener.log"
TARGET_CHAT_ID = -5368053565
ACTIVE = set()
LAST_SEEN = 0
MESSAGE_LOCK = asyncio.Lock()

logger = logging.getLogger("isu-listener")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.handlers.RotatingFileHandler(
        LOG_FILE, maxBytes=2_000_000, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)


def _write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def _is_video(message):
    if getattr(message, "video", None):
        return True
    doc = getattr(message, "document", None)
    if not doc:
        return False
    mime = getattr(doc, "mime_type", "") or ""
    return mime.startswith("video/") or any(
        attr.__class__.__name__ == "DocumentAttributeVideo"
        for attr in (getattr(doc, "attributes", []) or [])
    )


def _is_run_command(message):
    normalized = " ".join((getattr(message, "message", "") or "").split()).casefold()
    return normalized == "роби"


def _read_meta(job_dir):
    try:
        return json.loads((job_dir / "metadata.json").read_text(encoding="utf-8"))
    except Exception:
        return None


def _latest_pending(before_message_id):
    candidates = []
    for job_dir in QUEUE_ROOT.iterdir():
        if not job_dir.is_dir() or not (job_dir / "READY.flag").exists():
            continue
        data = _read_meta(job_dir)
        if not data or int(data.get("message_id", 0)) >= before_message_id:
            continue
        if data.get("status") == "pending_analysis":
            candidates.append((int(data["message_id"]), job_dir, data))
    return max(candidates, default=None, key=lambda item: item[0])

async def _queue_video(message):
    stamp = message.date.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    job_dir = QUEUE_ROOT / f"{stamp}_{message.id}"
    job_dir.mkdir(parents=True, exist_ok=True)
    meta_path = job_dir / "metadata.json"
    if meta_path.exists() and (job_dir / "READY.flag").exists():
        return job_dir

    sender = await message.get_sender()
    data = {
        "status": "downloading",
        "chat_id": TARGET_CHAT_ID,
        "message_id": message.id,
        "date_utc": message.date.astimezone(timezone.utc).isoformat(),
        "caption": (message.message or "").strip(),
        "sender_id": getattr(sender, "id", None),
    }
    _write_json(meta_path, data)
    try:
        local_file = await message.download_media(file=str(job_dir))
        data.update({
            "status": "pending_analysis",
            "local_file": str(local_file),
            "queued_at_utc": datetime.now(timezone.utc).isoformat(),
        })
        _write_json(meta_path, data)
        (job_dir / "READY.flag").write_text("ready", encoding="utf-8")
        logger.info("VIDEO_READY message_id=%s", message.id)
        return job_dir
    except Exception as exc:
        data.update({"status": "download_error", "error": f"{type(exc).__name__}: {exc}"})
        _write_json(meta_path, data)
        logger.exception("VIDEO_DOWNLOAD_ERROR message_id=%s", message.id)
        return None

def _post_video(path, caption):
    endpoint = os.environ.get(
        "ISU_ANALYSIS_URL",
        "https://isu-judge-telegram-worker.onrender.com/analyze-upload",
    )
    secret = os.environ.get("ISU_UPLOAD_SECRET", "")
    if not secret:
        raise RuntimeError("ISU_UPLOAD_SECRET is not configured")

    parsed = urlparse(endpoint)
    connection_type = (
        http.client.HTTPSConnection if parsed.scheme == "https"
        else http.client.HTTPConnection
    )
    conn = connection_type(parsed.hostname, parsed.port, timeout=900)
    target = parsed.path or "/"
    if parsed.query:
        target += "?" + parsed.query
    size = path.stat().st_size
    caption_b64 = base64.b64encode(caption.encode("utf-8")).decode("ascii")
    conn.putrequest("POST", target)
    conn.putheader("Content-Type", "application/octet-stream")
    conn.putheader("Content-Length", str(size))
    conn.putheader("X-ISU-Upload-Secret", secret)
    conn.putheader("X-ISU-Caption-B64", caption_b64)
    conn.endheaders()
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            conn.send(chunk)
    response = conn.getresponse()
    body = response.read()
    status = response.status
    conn.close()
    if status != 200:
        raise RuntimeError(f"analysis service HTTP {status}: {body[:300].decode('utf-8', 'replace')}")
    payload = json.loads(body.decode("utf-8"))
    if not payload.get("ok") or not payload.get("analysis"):
        raise RuntimeError(payload.get("error") or "analysis service returned no result")
    return payload

def _chunks(text, limit=3800):
    parts = []
    rest = (text or "").strip()
    while len(rest) > limit:
        cut = rest.rfind("\n", 0, limit)
        if cut < int(limit * 0.6):
            cut = rest.rfind(" ", 0, limit)
        if cut < int(limit * 0.6):
            cut = limit
        parts.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        parts.append(rest)
    return parts


async def _safe_edit(client, message_id, text):
    try:
        await client.edit_message(TARGET_CHAT_ID, message_id, text)
    except Exception as exc:
        logger.warning("STATUS_EDIT_FAILED message_id=%s error=%s", message_id, type(exc).__name__)


async def _process_job(client, job_dir, progress_message_id):
    data = _read_meta(job_dir)
    if not data:
        return
    video_id = int(data["message_id"])
    if video_id in ACTIVE:
        return
    ACTIVE.add(video_id)
    meta_path = job_dir / "metadata.json"
    try:
        local_file = Path(data["local_file"])
        data.update({
            "status": "processing",
            "progress_message_id": progress_message_id,
            "started_at_utc": datetime.now(timezone.utc).isoformat(),
        })
        _write_json(meta_path, data)
        logger.info("ANALYSIS_START message_id=%s", video_id)

        analysis_task = asyncio.create_task(
            asyncio.to_thread(_post_video, local_file, data.get("caption", ""))
        )
        started = time.monotonic()
        status_steps = [
            "⏳ Аналізую відео за правилами ISU 2026/27…",
            "⏳ Technical Panel: визначаю елементи та технічні позначки…",
            "⏳ Judge: перевіряю GOE та формую зрозумілий висновок…",
        ]
        step = 0
        while not analysis_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(analysis_task), timeout=25)
            except asyncio.TimeoutError:
                elapsed = int(time.monotonic() - started)
                text = f"{status_steps[step % len(status_steps)]}\nМинуло: {elapsed} с."
                await _safe_edit(client, progress_message_id, text)
                step += 1

        payload = await analysis_task
        await _safe_edit(
            client, progress_message_id,
            "✅ Аналіз завершено. Результат надіслано відповіддю до відео."
        )
        result_parts = _chunks("⛸️ ISU Judge 2026/27\n\n" + payload["analysis"])
        for index, part in enumerate(result_parts):
            prefix = "" if index == 0 else f"📄 Продовження {index + 1}/{len(result_parts)}\n\n"
            await client.send_message(TARGET_CHAT_ID, prefix + part, reply_to=video_id)
        if payload.get("parentSummary"):
            await client.send_message(TARGET_CHAT_ID, payload["parentSummary"], reply_to=video_id)

        data.update({
            "status": "processed",
            "completed_at_utc": datetime.now(timezone.utc).isoformat(),
            "analysis_mode": payload.get("mode"),
            "duration": payload.get("duration"),
        })
        _write_json(meta_path, data)
        (job_dir / "DONE.flag").write_text("done", encoding="utf-8")
        logger.info("ANALYSIS_DONE message_id=%s", video_id)

    except Exception as exc:
        data.update({
            "status": "analysis_error",
            "error": f"{type(exc).__name__}: {str(exc)[:500]}",
            "failed_at_utc": datetime.now(timezone.utc).isoformat(),
        })
        _write_json(meta_path, data)
        await _safe_edit(
            client, progress_message_id,
            f"⚠️ ISU Judge: аналіз не завершено. {str(exc)[:240]}"
        )
        logger.exception("ANALYSIS_ERROR message_id=%s", video_id)
    finally:
        ACTIVE.discard(video_id)


async def _handle_command(client, message):
    found = _latest_pending(message.id)
    if not found:
        await client.send_message(
            TARGET_CHAT_ID,
            "⚠️ Не бачу нового відео перед командою «Роби». Спочатку надішли відео.",
            reply_to=message.id,
        )
        logger.info("COMMAND_NO_PENDING command_id=%s", message.id)
        return
    _, job_dir, data = found
    ack = await client.send_message(
        TARGET_CHAT_ID,
        "⏳ Прийнято. Починаю аналіз останнього відео…",
        reply_to=message.id,
    )
    data.update({
        "status": "processing",
        "command_message_id": message.id,
        "progress_message_id": ack.id,
    })
    _write_json(job_dir / "metadata.json", data)
    asyncio.create_task(_process_job(client, job_dir, ack.id))
    logger.info("COMMAND_ACCEPTED command_id=%s video_id=%s", message.id, data["message_id"])

async def _resume_interrupted(client):
    for job_dir in QUEUE_ROOT.iterdir():
        if not job_dir.is_dir():
            continue
        data = _read_meta(job_dir)
        if not data or data.get("status") != "processing":
            continue
        progress_id = data.get("progress_message_id")
        if progress_id:
            logger.info("RESUME_PROCESSING video_id=%s", data.get("message_id"))
            asyncio.create_task(_process_job(client, job_dir, int(progress_id)))


async def _dispatch_message(client, message):
    global LAST_SEEN
    async with MESSAGE_LOCK:
        if message.id <= LAST_SEEN:
            return
        if _is_video(message):
            await _queue_video(message)
        elif _is_run_command(message):
            await _handle_command(client, message)
        LAST_SEEN = max(LAST_SEEN, message.id)
        STATE_FILE.write_text(str(LAST_SEEN), encoding="utf-8")


async def _event_runtime(client):
    chat = await client.get_entity(TARGET_CHAT_ID)
    logger.info(
        "LISTENER_ONLINE chat_id=%s title=%s after=%s mode=events",
        TARGET_CHAT_ID, getattr(chat, "title", ""), LAST_SEEN,
    )
    await _resume_interrupted(client)
    try:
        messages = await client.get_messages(TARGET_CHAT_ID, limit=50, min_id=LAST_SEEN)
        for message in sorted(messages, key=lambda item: item.id):
            await _dispatch_message(client, message)
    except Exception as exc:
        logger.warning("STARTUP_CATCHUP_SKIPPED error=%s", type(exc).__name__)
    await asyncio.Event().wait()


def start_isu_inbox(client):
    global LAST_SEEN
    task = getattr(client, "_isu_inbox_task", None)
    if task and not task.done():
        return task
    QUEUE_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        LAST_SEEN = int(STATE_FILE.read_text(encoding="utf-8").strip() or "0")
    except Exception:
        LAST_SEEN = 0

    from telethon import events

    async def on_new_message(event):
        try:
            await _dispatch_message(client, event.message)
        except Exception:
            logger.exception("EVENT_ERROR message_id=%s", getattr(event.message, "id", None))

    client.add_event_handler(on_new_message, events.NewMessage(chats=TARGET_CHAT_ID))
    client._isu_event_handler = on_new_message
    task = asyncio.create_task(_event_runtime(client))
    client._isu_inbox_task = task
    return task
