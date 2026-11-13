// Импортируем config
import { MESSAGES_INTERACTIVE_ELEMENTS } from "../../../config/constants.js";

// Импортируем utils
import { IsMobile } from "../../../utils/helpers/is_mobile.js";
import { Logger } from "../../../utils/logs/logger.js";
import { Icons } from "../../../utils/icons.js";
import { TimeAgoFormatter } from "../../../utils/date/time_ago_formatter.js";
import { GestureController } from "../../../utils/gesture_controller.js";

// Импортируем functions (переиспользуем рендер markdown из messages)
import { getMarkdownRenderer } from "../../messages/components/functions/create_markdown.js";
import { isValidEmojiOnly } from "../../messages/components/functions/render_only_emoji.js";

// Импортируем components (вложенные)
import { createReply } from "./message_reply.js";
import { messageAttaches } from "./message_attaches.js";

// Импортируем handlers
import { editMessageHandler } from "./handlers/edit_message.js";
import { replyMessageHandler } from "./handlers/reply_message.js";
import { contextMenuHandler } from "./handlers/context_menu.js";

// Импортируем типы
import type { StoreEventName } from "../../../utils/store.js";
import type { SecretChatMessageData } from "./types.js";
import type { SecretChat } from "../index.js";

/**
 * ***************************************************************************
 * SecretChatMessageItem - компонент строки сообщения секретного чата:
 * шаблон, рендер текста (markdown), статусы доставки, ответ и жесты
 * (тап/свайп в ответ).
 *
 * Форма создания - `createSecretChatMessageItem`: наружу отдаётся готовый
 * DOM-узел, экземпляр здесь — внутренняя деталь.
 * ***************************************************************************
 */
export class SecretChatMessageItem {

    /** Экземпляр формы секретного чата. */
    form: SecretChat;

    /** Данные сообщения. */
    data: SecretChatMessageData;

    /** Корневой DOM-элемент сообщения. */
    element: HTMLElement;

    /** Хранилище функций отписки. */
    unsubscribe: { updated: (() => void) | null } = {
        updated: null
    };

    // Ссылки на узлы шаблона: привязываются один раз в конструкторе
    // (_bindNodes) и переиспользуются всеми перерисовками _setup()
    // invariant: узлы входят в собственный шаблон _template(); при битом
    // шаблоне падение случится в _setup и будет поймано его catch
    presentation!: HTMLElement;
    textWrap!: HTMLElement;
    text!: HTMLElement;
    status!: HTMLElement;
    createdAt!: HTMLElement;
    statusIcon!: HTMLElement;
    attaches!: HTMLElement;
    reply!: HTMLElement;

    /**
     * ***************************************************************************
     * component
     * @param form - Класс формы.
     * @param data - Данные элемента.
     * ***************************************************************************
     */
    constructor(form: SecretChat, data: SecretChatMessageData) {

        // Записываем данные
        this.form = form;
        this.data = data;

        // Создаем DOM-элемент из шаблона
        this.element = this._template();

        // Привязываем узлы шаблона один раз — дальше _setup их переиспользует
        this._bindNodes();

        // Записываем ссылку на dom элемент
        if (!this.data.__domElements__) {
            this.data.__domElements__ = [];
        }
        this.data.__domElements__.push(this.element);

        // Устанавливаем начальные данные
        this._setup(this.data);

        // Прикрепляем обработчики событий
        this._actions();

        // Подписываем на обновление
        this._subscribeToUpdates();

        // Функция вызова редактирования сообщения
        this.data.__editMessage__ = () => editMessageHandler(this);

    }

    /**
     * ***************************************************************************
     * Шаблон элемента.
     * @returns DOM-элемент сообщения.
     * ***************************************************************************
     */
    _template(): HTMLElement {

        // Мы используем DOMParser для безопасного и чистого создания элемента
        // invariant: корневой .item входит в сам шаблон — querySelector
        // с текстовым HTML всегда находит его
        return new DOMParser().parseFromString(`

            <div class="item flex flex-row gap-2 py-1 w-full text-(length:--message-text-size)">
                <div class="block flex flex-row px-3 w-full max-w-[var(--secret-chat-block-max-width)] m-auto">
                    <div class="presentation relative flex flex-row gap-2 w-full">
                        <div class="wrap-content flex flex-col max-w-[85%]">
                            <div class="wrap flex flex-col w-full max-w-full p-2 gap-2 overflow-hidden rounded-xl shadow-xs">
                                <reply class="empty:hidden"></reply>
                                <attaches class="relative flex flex-col empty:hidden gap-0">
                                    <div data-media class="relative grid gap-1 empty:hidden"></div>
                                    <div data-documents class="flex flex-col empty:hidden"></div>
                                    <div data-audios class="relative flex flex-col empty:hidden gap-0"></div>
                                </attaches>
                                <div class="text-wrap flex flex-wrap items-end gap-x-2 gap-y-1 w-full overflow-hidden">
                                    <div data-text class="flex-1 w-full leading-[1.3] break-words whitespace-pre-line empty:hidden"></div>
                                    <div data-status class="flex flex-row z-3 gap-1 items-center mt-1 ml-1 text-muted text-[calc(var(--message-text-size)*0.8)] whitespace-nowrap select-none">
                                        <div data-status-icon class="flex items-center"></div>
                                        <span data-created-at class="text-muted"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        `, "text/html").querySelector<HTMLElement>(".item")!;

    }

    /**
     * ***************************************************************************
     * Привязка узлов шаблона (выполняется один раз в конструкторе).
     * @returns void
     * ***************************************************************************
     */
    _bindNodes(): void {

        // invariant: селекторы соответствуют шаблону _template() этого же
        // класса — узлы создаются вместе с элементом, non-null assertion
        // безопасен; при битом шаблоне падение поймает catch в _setup()
        this.presentation = this.element.querySelector<HTMLElement>(":scope >.block >.presentation")!;
        this.textWrap = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >.text-wrap")!;
        this.text = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >.text-wrap >[data-text]")!;
        this.status = this.element.querySelector<HTMLElement>(":scope [data-status]")!;
        this.createdAt = this.element.querySelector<HTMLElement>(":scope [data-status] >[data-created-at]")!;
        this.statusIcon = this.element.querySelector<HTMLElement>(":scope [data-status] >[data-status-icon]")!;
        this.attaches = this.element.querySelector<HTMLElement>(":scope attaches")!;
        this.reply = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >reply")!;

    }

    /**
     * ***************************************************************************
     * Установка/Перерисовка данных.
     * @param data - Данные сообщения.
     * @returns void
     * ***************************************************************************
     */
    _setup(data: SecretChatMessageData): void {

        try {

            // Сохраняем актуальные данные
            this.data = data;

            // Служебные иконки статуса пересобираются при каждой перерисовке
            this.statusIcon.innerHTML = "";

            // Парсим created_at
            let timeAgo = new TimeAgoFormatter(data.created_at, "telegram-time");
            this.createdAt.textContent = timeAgo.formattedTime;

            // Устанавливаем атрибут
            this.element.setAttribute("data-id", data.id);

            // Свои сообщения — справа
            if (data.sender === "me") {
                this.presentation.classList.add("justify-end");
            } else {
                this.presentation.classList.remove("justify-end");
            }

            // Ответ на сообщение
            if (this.data?.reply_to) {

                // Создаем ответ
                let replyWrap = createReply(this);

                // Очищаем контейнер и вставляем
                this.reply.innerHTML = "";
                this.reply.appendChild(replyWrap);

            } else {
                this.reply.innerHTML = "";
            }

            // Если есть текст
            if (data.text) {

                this.textWrap?.classList.remove("hidden");

                // Рендер markdown переиспользуем из messages. Текст секретного
                // чата — открытый plaintext (сервером не экранирован, его
                // там просто нет): markdown-it с html:false сам экранирует HTML.
                // Не добавлять других путей записи в this.text.innerHTML.
                const renderer = getMarkdownRenderer({ isBot: false });
                this.text.innerHTML = renderer.render(data.text).trim();

                // Определение только Emoji
                let isOnlyEmoji = isValidEmojiOnly(data.text);
                if (isOnlyEmoji) this.element.classList.add("only-emoji");

                // Переносим data-status в последний параграф
                let lastParagraph = this.text.querySelector(":scope >p:last-child");
                lastParagraph && lastParagraph.appendChild(this.status);
                lastParagraph && this.status.classList.add("float-right");

            } else {
                this.textWrap?.classList.add("hidden");
            }

            // Sticker-сообщение без текста — пузырю не нужен фон
            if (data.type === "sticker" && !data.text?.trim()) this.element.classList.add("sticker");

            // Отображаем вложения (фабрики forms/messages по AttachParent)
            messageAttaches(this);

            // Статус доставки — только у своих сообщений
            if (data.sender === "me") this._renderStatusIcon(data.status);

            // Индикатор самоуничтожения: сообщение исчезнет по таймеру
            if (data.self_destruct) {
                const hourglass = Icons.icon("hourglass", { settings: { size: 12 } });
                if (hourglass) this.statusIcon.prepend(hourglass);
            }

            // Есть вложение без текста — статус уходит в attaches (фаза вложений)
            if (data.file_id && !data.text?.trim()) {
                this.attaches.appendChild(this.status);
            }

        } catch (error) {
            Logger.error(error);
        }

    }

    /**
     * ***************************************************************************
     * Отрисовка иконки статуса доставки своего сообщения.
     * @param status - Статус доставки.
     * @returns void
     * ***************************************************************************
     */
    _renderStatusIcon(status: SecretChatMessageData["status"]): void {

        // Классы состояний строки (pending/error)
        this.element.classList.remove("pending", "error");

        // Черновик (вложения до отправки): как в messages — «пишется» либо
        // ошибка; invariant: иконки входят в набор Icons — prepend не принимает null
        if (this.data.is_temporary) {
            if (this.data.is_error_sending) {
                this.element.classList.add("error");
                this.statusIcon.prepend(Icons.icon("alert-triangle")!);
            } else {
                this.element.classList.add("pending");
                this.statusIcon.prepend(Icons.icon("pencil-minus")!);
            }
            return;
        }

        // invariant: иконки входят в набор Icons — prepend не принимает null
        switch (status) {

            // Ещё не доставлено (ждёт соединения/в полёте): часы
            case "queued":
            case "sending":
                this.element.classList.add("pending");
                this.statusIcon.prepend(Icons.icon("clock")!);
                break;

            // Отправлено/доставлено: одна галочка
            case "sent":
            case "delivered":
                this.statusIcon.prepend(Icons.icon("check")!);
                break;

            // Прочитано: две галочки
            case "read":
                this.statusIcon.prepend(Icons.icon("checks", { classes: ["stroke-brand-600", "dark:stroke-brand-500"] })!);
                break;

            // Ошибка доставки
            case "failed":
                this.element.classList.add("error");
                this.statusIcon.prepend(Icons.icon("alert-triangle")!);
                break;

        }

    }

    /**
     * ***************************************************************************
     * Обработчики: жесты строки (тап, долгий тап, свайп влево → ответ).
     * @returns void
     * ***************************************************************************
     */
    _actions(): void {

        // Игнорируемые элементы
        let ignoreElements = this.textWrap.querySelectorAll<HTMLElement>("pre");

        // GestureController
        let controller = new GestureController(this.element, {
            ignore: [...ignoreElements],
            threshold: 5,
            onContextMenu: (event) => {
                event.preventDefault();
                if (!IsMobile.get()) {
                    contextMenuHandler(event, this);
                }
            },
            tap: {
                onTap: (event) => {
                    // Если нажали на ссылку или кнопку — выходим из onTap,
                    // это позволит браузеру выстрелить обычный 'click'
                    // event.target — EventTarget: ближайший узел ищем только у Element
                    const target = event.target instanceof Element ? event.target : null;
                    const interactiveTarget = target?.closest(MESSAGES_INTERACTIVE_ELEMENTS);
                    if (interactiveTarget) return;

                    // Если мобильная версия
                    if (IsMobile.get()) {
                        if (event.cancelable) event.preventDefault();
                        contextMenuHandler(event, this);
                    }
                }
            },
            swipe: {
                directions: ["left"],
                commitDistance: 60,
                onStart: () => {
                    this.element.style.transition = "";
                    this.element.classList.add("dragging");
                },
                onMove: (dx) => {
                    this.element.style.setProperty("--current-translate", `${dx}px`);
                    this.element.style.transform = `translate3d(${dx}px, 0, 0)`;
                },
                onCommit: () => {
                    replyMessageHandler(this);

                    // Финализируем жест повторным вызовом: событие отпускания
                    // сюда не приходит, в ветке свайпа endGesture его не читает
                    controller.endGesture(controller.lastX, controller.lastY, controller.startEvent ?? new MouseEvent("mouseup"));
                },
                onCancel: () => { },
                onEnd: () => {
                    this.element.style.transition = "transform 0.2s ease";
                    this.element.style.transform = "translate3d(0, 0 ,0)";
                    this.element.classList.remove("dragging");
                }
            }
        });

    }

    /**
     * ***************************************************************************
     * ПУБЛИЧНЫЙ МЕТОД: Обновление элемента.
     * @param data - Новые данные сообщения.
     * @returns void
     * ***************************************************************************
     */
    update(data: SecretChatMessageData): void {

        // Передаем новые данные в _setup, чтобы перерисовать DOM
        this._setup(data);

    }

    /**
     * ***************************************************************************
     * Подписка на точечное событие обновления.
     * @returns void
     * ***************************************************************************
     */
    _subscribeToUpdates(): void {

        try {

            // Перед переподпиской вызываем старую функцию очистки, если она есть
            if (this.unsubscribe.updated) this.unsubscribe.updated();

            // Формируем уникальное имя события
            let itemUpdatedEvent: StoreEventName = `item::updated::${this.data.id}`;

            // Подписываемся и сохраняем функцию отписки
            this.unsubscribe.updated = this.form.store.on(itemUpdatedEvent, async (data) => {

                // Store.update() эмитит событие даже если элемента нет в Map —
                // в этом случае data === undefined, и перерисовка упала бы в catch
                if (!data) return;

                // invariant: событие item::updated отдаёт данные этого сообщения
                this.update(data as SecretChatMessageData);

            });

            // Сохраняем объединенную функцию отписки для внешнего вызова
            this.data.__unsubscribeStore__ = () => {
                if (this.unsubscribe.updated) this.unsubscribe.updated();
            };

        } catch (error) {
            Logger.error(error);
        }

    }

}

/**
 * ***************************************************************************
 * createSecretChatMessageItem - фабрика строки сообщения секретного чата:
 * единая точка входа для Store-событий. Наружу возвращается готовый DOM-узел.
 * @param form - Экземпляр формы.
 * @param data - Данные сообщения.
 * @returns DOM-элемент сообщения.
 * ***************************************************************************
 */
export function createSecretChatMessageItem(form: SecretChat, data: SecretChatMessageData): HTMLElement {

    // Обычная строка: возвращаем элемент экземпляра
    return new SecretChatMessageItem(form, data).element;

}
