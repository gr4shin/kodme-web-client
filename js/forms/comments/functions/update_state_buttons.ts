// Импортируем utils
import { Logger } from "../../../utils/logs/logger.js";
import * as Attachments from "../../../utils/messages/attachments.js";

// Импортируем типы
import type { Comments } from "../index.js";

/**
 * ***************************************************************************
 * updateStateButtons - переключение состояний кнопок футера формы.
 *
 * Показ «Отправить»/«Обновить» считается по тексту и вложениям через
 * нормализатор. Запись голосового и видео-кружка показывается только при
 * пустом поле без вложений: при набранном тексте старт записи унёс бы
 * черновик. Во время идущей голосовой записи футер держит поле и микрофон
 * видимыми (микрофон отменяет запись), остальное прячется.
 *
 * Режим редактирования определяется по `form.editedComment`:
 * при нём футер переключается на «Обновить»/«Отмена», а эмодзи/скрепка
 * прячутся (редактируем существующий комментарий, а не создаём новый).
 * @param form - Экземпляр формы.
 * @returns void
 * ***************************************************************************
 */
export function updateStateButtons(form: Comments): void {

    try {

        // Если формы нет
        if (!form) return;

        // Объекты берём из кэша формы (повторный querySelector не нужен)
        const textarea = form.textarea;
        const createButton = form.tpl?.querySelector(":scope >.footer [action-create-comment]");
        const updateButton = form.tpl?.querySelector(":scope >.footer [action-update-comment]");
        const cancelEditButton = form.tpl?.querySelector(":scope >.footer [action-cancel-edit]");
        const attachFileButton = form.tpl?.querySelector(":scope >.footer [action-attach-file]");
        const emojiButton = form.tpl?.querySelector(":scope >.footer [action-emoji]");
        const voiceRecorderButton = form.tpl?.querySelector(":scope >.footer [action-voice-recorder]");
        const videoRecorderButton = form.tpl?.querySelector(":scope >.footer [action-video-recorder]");

        // Без textarea и футера нечего обновлять
        if (!textarea) return;

        const isVideoMode = form.tpl?.querySelector<HTMLElement>("[data-note-recorder]")?.dataset.recordingMode === "video";

        // ---------- ИДЁТ ЗАПИСЬ ГОЛОСОВОГО ----------

        // Во время записи оставляем поле ввода и кнопку микрофона видимыми,
        // чтобы футер не сжимался, а микрофон мог отменить запись
        if (form.voiceRecorder || form.videoNoteRecorder?.recorder.isRecording) {
            textarea.classList.remove("hidden");
            createButton?.classList.add("hidden");
            updateButton?.classList.add("hidden");
            cancelEditButton?.classList.add("hidden");
            emojiButton?.classList.add("hidden");
            attachFileButton?.classList.add("hidden");
            voiceRecorderButton?.classList.toggle("hidden", isVideoMode);
            videoRecorderButton?.classList.toggle("hidden", !isVideoMode);
            return;
        }

        // Режим редактирования (черновик ответа в Этапе 5 включается так же,
        // но футер остаётся в режиме «Отправить»)
        const isEditing = Boolean(form.editedComment);

        // Текст или вложения в поле/черновике (черновик в Store, поэтому
        // проверяем и его)
        const hasTextOrAttaches = Boolean(textarea.value.trim())
            || Attachments.isNotEmpty(form.tempComment?.attachments)
            || isEditing;

        // ---------- РЕЖИМ РЕДАКТИРОВАНИЯ ----------

        if (isEditing) {

            // «Отправить»/голос/кружок/эмодзи/скрепка скрыты, «Обновить»/«Отмена» видны
            createButton?.classList.add("hidden");
            voiceRecorderButton?.classList.add("hidden");
            videoRecorderButton?.classList.add("hidden");
            emojiButton?.classList.add("hidden");
            attachFileButton?.classList.add("hidden");
            updateButton?.classList.remove("hidden");
            cancelEditButton?.classList.remove("hidden");

            // ---------- ОБЫЧНЫЙ РЕЖИМ ----------

        } else {

            // Показ/скрытие «Отправить» — по факту контента (пара hidden/flex
            // не требуется: кнопка участвует в flex-раскладке, но её контейнер
            // скрыт через hidden — Tailwind: .hidden идёт после .flex)
            createButton?.classList.toggle("hidden", !hasTextOrAttaches);

            // Голос/кружок — только при пустом черновике (иначе старт записи
            // перетащил бы текст/вложения в заметку)
            voiceRecorderButton?.classList.toggle("hidden", hasTextOrAttaches || isVideoMode);
            videoRecorderButton?.classList.toggle("hidden", hasTextOrAttaches || !isVideoMode);

            // Эмодзи/скрепка доступны всегда (кроме редактирования)
            emojiButton?.classList.remove("hidden");
            attachFileButton?.classList.remove("hidden");

            // Кнопки редактирования скрыты
            updateButton?.classList.add("hidden");
            cancelEditButton?.classList.add("hidden");

        }

    } catch (error) {
        Logger.error("[app][comments][state-buttons]", error);
    }

}
