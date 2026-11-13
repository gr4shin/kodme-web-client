// Импортируем utils
import { Logger } from "../../../utils/logs/logger.js";
import * as Attachments from "../../../utils/messages/attachments.js";

// Импортируем типы
import type { Messages } from "../index.js";

/**
 * ***************************************************************************
 * updateStateButtons - переключение состояний кнопок футера формы:
 * запись голосового / редактирование / обычный ввод.
 *
 * Запись (голосовое и видео-кружок) показывается только при пустом поле без
 * вложений: при набранном тексте или прикреплённых файлах старт записи
 * унёс бы черновик — прячем обе кнопки.
 *
 * Показ «Отправить» считается по тексту и вложениям через нормализатор.
 * @param form - Экземпляр формы.
 * @returns void
 * ***************************************************************************
 */
export function updateStateButtons(form: Messages): void {

    try {

        // Если не передана форма
        if (!form) return;

        // Кнопки футера и поле ввода живут в шаблоне — без них нечего переключать
        const tpl = form.tpl;
        const textarea = form.textarea;
        if (!tpl || !textarea) return;

        // Устанавливаем объекты
        let create = tpl.querySelector(`:scope >.footer [action-create-message]`);
        let update = tpl.querySelector(`:scope >.footer [action-update-message]`);
        let cancelEdit = tpl.querySelector(`:scope >.footer [action-cancel-edit]`);
        let emoji = tpl.querySelector(":scope >.footer [action-emoji]");
        let botMenu = tpl.querySelector(":scope >.footer [action-bot-menu]");
        let attachFile = tpl.querySelector(":scope >.footer [action-attach-file]");
        let voiceRecorder = tpl.querySelector(":scope >.footer [action-voice-recorder]");
        let videoRecorder = tpl.querySelector(":scope >.footer [action-video-recorder]");

        // Кнопки обязаны входить в футер шаблона
        if (!create || !update || !cancelEdit || !emoji || !botMenu || !attachFile || !voiceRecorder || !videoRecorder) return;

        const isVideoMode = tpl.querySelector<HTMLElement>("[data-note-recorder]")?.dataset.recordingMode === "video";

        // 1. Если идёт запись звука
        if (form.voiceRecorder || form.videoNoteRecorder?.recorder.isRecording) {
            // Во время записи оставляем поле ввода и кнопку микрофона видимыми,
            // чтобы футер не сжимался, а микрофон мог отменить запись.
            textarea.classList.remove("hidden");
            create.classList.add("hidden");
            update.classList.add("hidden");
            cancelEdit.classList.add("hidden");
            emoji.classList.add("hidden");
            attachFile.classList.add("hidden");
            botMenu.classList.add("hidden");
            voiceRecorder.classList.toggle("hidden", isVideoMode);
            videoRecorder.classList.toggle("hidden", !isVideoMode);
            return;
        }

        // 2. Если сообщение редактируется (и нет записи звука)
        if (form.editedMessage?.id) {
            textarea.classList.remove("hidden");
            create.classList.add("hidden");
            update.classList.remove("hidden");
            cancelEdit.classList.remove("hidden");
            emoji.classList.remove("hidden");
            attachFile.classList.remove("hidden");

            // Запись при редактировании недоступна: старт записи унёс бы
            // редактируемый текст и вложения черновика
            voiceRecorder.classList.add("hidden");
            videoRecorder.classList.add("hidden");

            // Получаем текст
            let text = textarea.value;

            // Если есть боты
            if (form.channel?.bots && form.channel?.bots?.length > 0) {

                // Проверяем команду
                if (text.startsWith("/")) {
                    emoji.classList.add("hidden");
                } else {
                    botMenu.classList.add("hidden");
                    emoji.classList.remove("hidden");
                }

            }

            return;
        }

        // 3. Обычное состояние (нет записи, нет редактирования)
        textarea.classList.remove("hidden");
        emoji.classList.remove("hidden");
        attachFile.classList.remove("hidden");

        // Если есть боты
        if (form.channel?.bots && form.channel?.bots?.length > 0) {
            botMenu.classList.remove("hidden");
        } else {
            botMenu.classList.add("hidden");
        }

        // Проверяем текст в textarea
        let text = textarea.value;
        let hasTextOrAttachments = textarea.value !== "" || Attachments.isNotEmpty(form.tempMessage?.attachments);

        if (hasTextOrAttachments) {
            create.classList.remove("hidden");

            // С текстом или вложениями запись недоступна: старт записи
            // унёс бы черновик, а кнопки отправки — уже достаточно
            voiceRecorder.classList.add("hidden");
            videoRecorder.classList.add("hidden");

            // Если есть боты
            if (form.channel?.bots && form.channel?.bots?.length > 0) {

                // Проверка на команду (начинается со слеша)
                if (text.startsWith("/")) {
                    emoji.classList.add("hidden");
                } else {
                    emoji.classList.remove("hidden");
                    botMenu.classList.add("hidden");
                }

            }

        } else {

            // Пустое поле — показываем выбранный режим записи.
            voiceRecorder.classList.toggle("hidden", isVideoMode);
            videoRecorder.classList.toggle("hidden", !isVideoMode);
            create.classList.add("hidden");
            emoji.classList.remove("hidden");
        }

        // Скрываем кнопки редактирования, если они есть
        update.classList.add("hidden");
        cancelEdit.classList.add("hidden");

    } catch (error) {
        Logger.error(error);
    }

}
