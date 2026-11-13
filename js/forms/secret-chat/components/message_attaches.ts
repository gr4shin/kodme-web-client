// Импортируем utils
import { Logger } from "../../../utils/logs/logger.js";
import * as Attachments from "../../../utils/messages/attachments.js";
import * as AttachClassifier from "../../../utils/messages/attach_classifier.js";

// Импортируем components (локальные фабрики вложений)
import { createStickerItem } from "./attaches_sticker.js";
import { createAudioNoteItem } from "./attaches_audio_note.js";
import { createAudioItem } from "./attaches_audio.js";
import { createVideoItem } from "./attaches_video.js";
import { createVideoNoteItem } from "./attaches_video_note.js";
import { createDocumentItem } from "./attaches_document.js";
import { createImageItem } from "./attaches_image.js";

// Импортируем типы
import { normalizeAttachments, sortAttachmentsByFiles } from "./types.js";
import type { SecretChatMessageItem } from "./message.js";

/**
 * ***************************************************************************
 * messageAttaches - сборка блока вложений сообщения: классификация файлов
 * единым классификатором и раскладка по контейнерам (медиа/аудио/документы).
 *
 * Механика — как в forms/messages/components/message_attaches.ts; стикеры
 * в секретных чатах — отдельной фазой.
 * @param message - Родительский компонент сообщения.
 * @returns void
 * ***************************************************************************
 */
export function messageAttaches(message: SecretChatMessageItem): void {

    try {

        // Полноразмерный пузырь только для фото/видео без подписи.
        const mediaAttachments = normalizeAttachments(message.data.attachments ?? []);
        const isMediaOnly = !message.data.text?.trim()
            && mediaAttachments.length > 0
            && mediaAttachments.every(attachment => {
                const type = AttachClassifier.classify(attachment);
                return type === AttachClassifier.ATTACH_TYPES.IMAGE
                    || type === AttachClassifier.ATTACH_TYPES.VIDEO;
            });
        message.element.classList.toggle("media-only", isMediaOnly);

        // Определяем контейнеры
        let attachesContainer = message.element.querySelector(":scope attaches");

        // Контейнеры входят в шаблон сообщения — без них блок не настроить
        if (!attachesContainer) return;

        // Определяем контейнеры
        let documentsContainer = message.element.querySelector(":scope attaches >[data-documents]");
        let audiosContainer = message.element.querySelector(":scope attaches >[data-audios]");
        let mediaContainer = message.element.querySelector<HTMLElement>(":scope attaches >[data-media]");

        // Подконтейнеры обязаны входить в шаблон — иначе раскладывать нечего
        if (!documentsContainer || !audiosContainer || !mediaContainer) return;

        // Стикер-сообщение: картинка стикера (единственное содержимое блока)
        const sticker = createStickerItem(message);

        // Если нет ни вложений, ни стикера — прячем блок. Проверяем через
        // нормализатор: вложения живут объект-мапом по file_id
        if (!sticker && !Attachments.isNotEmpty(message.data?.attachments)) {
            attachesContainer.classList.add("hidden");
            return;
        }

        // Убираем скрытие
        attachesContainer.classList.remove("hidden");

        // Очищаем список
        documentsContainer.innerHTML = "";
        audiosContainer.innerHTML = "";
        mediaContainer.innerHTML = "";

        // Стикер встаёт в медиа-контейнер (у sticker-сообщений это
        // единственное содержимое блока)
        if (sticker) {
            mediaContainer.append(sticker);
            return;
        }

        // Нормализуем вложения в массив: объект-мап по file_id
        const attachments = message.data.attachments ? normalizeAttachments(message.data.attachments) : [];

        // Подстраховка сортировки: порядок вложений сообщения сохраняем
        // по порядку метаданных payload (объект-мап не гарантирует порядок)
        sortAttachmentsByFiles(attachments, message.data.files);

        // Проходим по файлам
        for (const attachment of attachments) {

            // Пропускаем мусор (редкое, но не повод ронять весь блок)
            if (!attachment) continue;

            // Тип вложения определяет единый классификатор: он знает и про
            // mime_type/type, и про голосовые/видео-кружки по метадате
            const type = AttachClassifier.classify(attachment);

            // Изображение
            if (type === AttachClassifier.ATTACH_TYPES.IMAGE) {

                // Создаем изображение
                let image = createImageItem(message, attachment);
                mediaContainer.append(image);

                // Голосовое сообщение (проверка на волну — внутри isAudioNote)
            } else if (AttachClassifier.isAudioNote(attachment)) {

                // Создаем voice
                let voice = createAudioNoteItem(message, attachment);
                audiosContainer.append(voice);

                // Обычное аудио
            } else if (type === AttachClassifier.ATTACH_TYPES.AUDIO) {

                // Создаем аудио
                let audio = createAudioItem(message, attachment);
                audiosContainer.append(audio);

                // Видео-кружок
            } else if (AttachClassifier.isVideoNote(attachment)) {

                // Помечаем сообщение как video-note
                message.element.classList.add("video-note");

                // Создаем video note
                let video = createVideoNoteItem(attachment);
                mediaContainer.append(video);

                // Обычное видео
            } else if (type === AttachClassifier.ATTACH_TYPES.VIDEO) {

                // Создаем video
                let video = createVideoItem(message, attachment);
                mediaContainer.append(video);

            } else {

                // Создаем простой документ
                let document = createDocumentItem(attachment);
                documentsContainer.append(document);

            }

        }

    } catch (error) {
        Logger.error(error);
    }

}
