"use strict";

class AnkiService {
  constructor({ log }) {
    this.url = "http://127.0.0.1:8765";
    this.log = log;
    this.requestQueue = Promise.resolve();
  }

  async invoke(action, params = {}, timeoutMs = 5000) {
    const operation = this.requestQueue.then(() => this.invokeNow(action, params, timeoutMs));
    this.requestQueue = operation.catch(() => {});
    return operation;
  }

  async invokeNow(action, params = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, version: 6, params }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);
      this.log?.(`AnkiConnect ${action} completed in ${Date.now() - startedAt}ms`);
      return payload.result;
    } catch (error) {
      this.log?.(`AnkiConnect ${action} failed after ${Date.now() - startedAt}ms: ${error.stack || error}`);
      if (error.cause?.code === "ECONNREFUSED") {
        throw new Error("Ankiに接続できません。Ankiを起動し、AnkiConnectアドオン（コード: 2055492159）が有効か確認してください。");
      }
      if (error.name === "AbortError") {
        throw new Error(`AnkiConnectの「${action}」処理が${Math.ceil(timeoutMs / 1000)}秒以内に完了しませんでした。Ankiの同期処理が終わるまで待ってから再試行してください。`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async diagnose(settings) {
    const version = await this.invoke("version");
    const [decks, models] = await Promise.all([this.invoke("deckNames"), this.invoke("modelNames")]);
    return {
      version,
      deckExists: decks.includes(settings.deckName),
      modelExists: models.includes(settings.modelName),
      decks,
      models
    };
  }

  duplicateTag(sceneId) {
    return `BigCoach_ID_${sceneId}`;
  }

  async findDuplicates(sceneId) {
    return this.invoke("findNotes", { query: `tag:${this.duplicateTag(sceneId)}` });
  }

  async storeImage(dataUrl, sceneId, suffix = "") {
    const data = String(dataUrl).replace(/^data:image\/png;base64,/, "");
    const filename = `bigcoach_${sceneId}${suffix ? `_${suffix}` : ""}.png`;
    await this.invoke("storeMediaFile", { filename, data }, 60000);
    return filename;
  }

  async storeMedia(filename, dataBase64) {
    await this.invoke("storeMediaFile", { filename, data: dataBase64 }, 30000);
    return filename;
  }

  async fieldsFor(settings, frontHtml, backHtml) {
    const names = await this.invoke("modelFieldNames", { modelName: settings.modelName });
    if (!Array.isArray(names) || names.length < 2) {
      throw new Error(`ノートタイプ「${settings.modelName}」には表面・裏面の2フィールドが必要です。`);
    }
    return { [names[0]]: frontHtml, [names[1]]: backHtml };
  }

  async add({ settings, scene, frontHtml, backHtml, duplicateMode }) {
    const duplicates = await this.findDuplicates(scene.sceneId);
    if (duplicates.length && duplicateMode === "skip") return { skipped: true, duplicateIds: duplicates };
    const [decks, models] = await Promise.all([this.invoke("deckNames"), this.invoke("modelNames")]);
    if (!decks.includes(settings.deckName)) {
      await this.invoke("createDeck", { deck: settings.deckName });
    }
    if (!models.includes(settings.modelName)) {
      await this.invoke("createModel", {
        modelName: settings.modelName,
        inOrderFields: ["表面", "裏面"],
        css: ".card { font-family: 'Yu Gothic UI', sans-serif; font-size: 18px; text-align: left; color: #222; background: white; } table { width: 100%; border-collapse: collapse; } th, td { padding: 6px; border-bottom: 1px solid #ddd; }",
        isCloze: false,
        cardTemplates: [{
          Name: "カード1",
          Front: "{{表面}}",
          Back: "{{FrontSide}}<hr id=answer>{{裏面}}"
        }]
      });
    }
    const fields = await this.fieldsFor(settings, frontHtml, backHtml);
    const baseTags = [...new Set([...(settings.tags || []), this.duplicateTag(scene.sceneId), "BigCoach"])];
    if (duplicates.length && duplicateMode === "overwrite") {
      const note = { id: duplicates[0], fields };
      await this.invoke("updateNoteFields", { note });
      await this.invoke("addTags", { notes: [duplicates[0]], tags: baseTags.join(" ") });
      return { updated: true, noteId: duplicates[0], duplicateIds: duplicates };
    }
    if (duplicates.length && duplicateMode === "separate") baseTags.push(`BigCoach_copy_${Date.now()}`);
    const noteId = await this.invoke("addNote", {
      note: {
        deckName: settings.deckName,
        modelName: settings.modelName,
        fields,
        options: { allowDuplicate: true },
        tags: baseTags
      }
    }, 15000);
    return { added: true, noteId, duplicateIds: duplicates };
  }
}

module.exports = { AnkiService };
