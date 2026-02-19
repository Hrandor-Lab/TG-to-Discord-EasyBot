export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK");
    }

    try {
      // ===== Получаем update =====
      const update = await request.json();
      console.log("📩 Update received:", JSON.stringify(update));

      const post = update.channel_post;
      if (!post) return new Response("OK");

      const postText = post.text || post.caption || "";
      const postPhotos = post.photo || [];
      const postVideo = post.video;

      const roleId = env.ROLE_ID || null;

      // ===== Получаем конфиги из Settings (Text -> JSON.parse) =====
      const webhookConfig = JSON.parse(env.WEBHOOK_CONFIG || "[]");
      const embedConfig = JSON.parse(env.EMBED_CONFIG || "{}");

      // ===== Проверка NoPost тегов =====
      const noPostTags = webhookConfig.find(w => w.name === "NoPost")?.tags || [];
      if (noPostTags.some(tag => postText.includes(tag))) {
        console.log("⛔ NoPost tag found, skipping post");
        return new Response("OK");
      }

      // ===== Выбор вебхука =====
      let selectedWebhook = webhookConfig.find(w => {
        if (w.name === "NoPost" || w.name === "Default") return false; // пропускаем специальные блоки
        const tags = w.tags || [];
        const matchTags = tags.some(tag => postText.includes(tag));
        const matchContains = w.contains && postText.includes(w.contains);
        return matchTags || matchContains;
      });

      // Если ни один блок не подошёл — берем Default
      if (!selectedWebhook) {
        selectedWebhook = webhookConfig.find(w => w.name === "Default");
        if (!selectedWebhook || !selectedWebhook.webhook) {
          console.log("⛔ No webhook found including Default, skipping post");
          return new Response("OK");
        }
        console.log(`⚡ Using Default webhook: ${selectedWebhook.webhook}`);
      } else {
        console.log(`🔗 Webhook selected: ${selectedWebhook.webhook}`);
      }

      const tgMessageUrl = `https://t.me/${post.chat.username}/${post.message_id}`;

      // ===== Формируем embed =====
      let embedTitle = embedConfig.telegramTitle || "Тыкай, чтобы читать в Telegram";
      let embedColor = embedConfig.telegramColor ? parseInt(embedConfig.telegramColor.replace("#", ""), 16) : 0x007BFF;

      if (postVideo) {
        embedTitle = embedConfig.videoTitle || "Жмякай, чтобы посмотреть видео";
        embedColor = embedConfig.videoColor ? parseInt(embedConfig.videoColor.replace("#", ""), 16) : 0xFF9900;
      }

      const embed = { title: embedTitle, url: tgMessageUrl, color: embedColor };

      // ===== Формируем текст сообщения =====
      let content = `<@&${roleId}>\n${postText}`;
      if (postPhotos.length > 0) content += `\n`;

      // ===== Отправка фото =====
      if (postPhotos.length > 0) {
        const photo = postPhotos[postPhotos.length - 1]; // самое крупное
        const fileId = photo.file_id;
        console.log("📡 file_id:", fileId);

        // Получение file_path
        const fileInfoResp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileInfo = await fileInfoResp.json();
        console.log("📄 getFile response:", fileInfo);

        if (!fileInfo.ok || !fileInfo.result.file_path) {
          console.log("❌ Failed to get file_path");
          content += "\n❌ Не удалось получить изображение";
        } else {
          const filePath = fileInfo.result.file_path;
          const fileResp = await fetch(`https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`);
          const arrayBuffer = await fileResp.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: "image/jpeg" });

          const form = new FormData();
          form.append("payload_json", JSON.stringify({ content, embeds: [embed] }));
          form.append("file", blob, "image.jpg");

          await fetch(selectedWebhook.webhook, { method: "POST", body: form });
          console.log("✅ Photo sent to Discord");
          return new Response("OK");
        }
      }

      // ===== Отправка embed без фото =====
      await fetch(selectedWebhook.webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, embeds: [embed] })
      });
      console.log("✅ Embed sent to Discord");

      return new Response("OK");
    } catch (err) {
      console.error("❌ Worker error:", err);
      return new Response("Internal error", { status: 500 });
    }
  }
};