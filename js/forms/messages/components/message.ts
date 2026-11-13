// Импортируем config
import { MESSAGES_INTERACTIVE_ELEMENTS } from "../../../config/constants.js";

// Импортируем utils
import { IsMobile } from "../../../utils/helpers/is_mobile.js";
import { Logger } from "../../../utils/logs/logger.js";
import { Icons } from "../../../utils/icons.js";
import { GestureController } from "../../../utils/gesture_controller.js";
import { unescapeHtml } from "../../../utils/string/unescape_html.js";
import { I18n, t } from "../../../utils/i18n/index.js";
import * as Attachments from "../../../utils/messages/attachments.js";

// Импортируем components
import { Avatars } from "../../../components/avatars.js";

// Импортируем components (вложенные)
import { createForward } from "./message_forward.js";
import { createReply } from "./message_reply.js";
import { messageButtons } from "./message_buttons.js";
import { messageAttaches } from "./message_attaches.js";
import { messageReactions } from "./message_reactions.js";
import { createSystemMessage } from "./message_system.js";

// Импортируем functions
import { getMarkdownRenderer } from "./functions/create_markdown.js";
import { preCodeActions } from "./functions/precode_actions.js";
import { urlify } from "./functions/urlify.js";
import { isValidEmojiOnly } from "./functions/render_only_emoji.js";
import { getSessionUserId } from "../../main/functions/session_identity.js";

// Импортируем handlers
import { editMessageHandler } from "./handlers/edit_message.js";
import { replyMessageHandler } from "./handlers/reply_message.js";
import { contextMenuHandler } from "./handlers/context_menu.js";

// Импортируем формы
import { Comments } from "../../comments/index.js";

// Импортируем типы
import type { StoreEventName, StoreIdChange } from "../../../utils/store.js";
import type { MessageData, MessageReaction } from "./types.js";
import type { Messages } from "../index.js";

/**
 * ***************************************************************************
 * MessageItem - компонент строки сообщения: шаблон, рендер текста (markdown),
 * статусы, вложения, реакции, ответ/пересылка и жесты (тап/свайп в ответ).
 *
 * Форма создания - `createMessageItem`: инстанс класса — внутренняя деталь,
 * наружу отдаётся готовый элемент.
 * ***************************************************************************
 */
export class MessageItem {

    /** Экземпляр формы сообщений. */
    form: Messages;

    /** Данные сообщения. */
    data: MessageData;

    /** Показывать ли заголовок автора (зависит от типа канала). */
    isTitle = true;

    /** Показывать ли аватар (зависит от типа канала). */
    isAvatar = true;

    /** Корневой DOM-элемент сообщения. */
    element: HTMLElement;

    /** Хранилище функций отписки. */
    unsubscribe: { updated: (() => void) | null; idChanged: (() => void) | null } = {
        updated: null,
        idChanged: null
    };

    // Ссылки на узлы шаблона: привязываются один раз в конструкторе
    // (_bindNodes) и переиспользуются всеми перерисовками _setup()
    // invariant: узлы входят в собственный шаблон _template(); при битом
    // шаблоне падение случится в _setup и будет поймано его catch
    block!: HTMLElement;
    presentation!: HTMLElement;
    avatar!: HTMLElement;
    title!: HTMLElement;
    displayName!: HTMLElement;
    displayType!: HTMLElement;
    textWrap!: HTMLElement;
    text!: HTMLElement;
    status!: HTMLElement;
    createdAt!: HTMLElement;
    statusIcon!: HTMLElement;
    attaches!: HTMLElement;
    buttons!: HTMLElement;
    comments!: HTMLElement;
    commentsCount!: HTMLElement;
    commentsText!: HTMLElement;
    reply!: HTMLElement;
    forward!: HTMLElement;

    /**
     * ***************************************************************************
     * component
     * @param form - Класс формы.
     * @param data - Данные элемента.
     * ***************************************************************************
     */
    constructor(form: Messages, data: MessageData) {

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

        // Функция для обновления статуса сообщения (прочитано)
        this.data.__updateStatusRead__ = () => this._updateStatusRead();

        // Функция для обновления реакций сообщения (тип параметра берётся
        // из хука в типах сообщения)
        this.data.__updateReactions__ = (reactions) => this._updateReactions(reactions);

        // Функция вызова редактирования сообщения
        this.data.__editMessage__ = () => editMessageHandler(this);

    }

    /**
     * ***************************************************************************
     * Шаблон элемента.
     * Используем DOMParser для безопасного и чистого создания элемента.
     * @returns DOM-элемент сообщения.
     * ***************************************************************************
     */
    _template(): HTMLElement {

        // Мы используем <template> tag или DOMParser для создания DOM без innerHTML
        // invariant: корневой .item входит в сам шаблон — querySelector
        // с текстовым HTML всегда находит его
        return new DOMParser().parseFromString(`

            <div class="item flex flex-row gap-2 py-1 w-full text-(length:--message-text-size)">
                <div class="block flex flex-row px-3 w-full max-w-[var(--messages-block-max-width)] m-auto">
                    <div class="presentation relative flex flex-row gap-2 w-full">
                        <div class="cdm-avatar relative"></div>
                        <div class="wrap-content flex flex-col max-w-[85%]">
                            <div class="wrap flex flex-col w-full max-w-full p-2 gap-2 overflow-hidden rounded-xl shadow-xs">
                                <forward class="empty:hidden"></forward>
                                <reply class="empty:hidden"></reply>
                                <div data-title class="flex flex-row gap-2 empty:hidden">
                                    <span data-display-name class="text-secondary text-sm"></span>
                                    <span data-display-type class="text-muted text-sm"></span>
                                </div>
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
                                <comments class="flex flex-row flex-wrap gap-2 py-2 pb-0 border-t border-[var(--border-color)] text-[var(--color-brand)] font-semibold items-center cursor-pointer">
                                    ${Icons.icon("message-2")?.outerHTML}
                                    <div class="flex flex-row items-center gap-1">
                                        <span data-count></span>
                                        <span data-text></span>
                                    </div>
                                </comments>
                            </div>
                            <buttons class="empty:hidden"></buttons>
                            <reactions class="flex flex-row flex-wrap gap-1 p-2 px-0 items-center empty:hidden"></reactions>
                        </div>
                    </div>
                </div>
            </div>

        `, "text/html").querySelector<HTMLElement>(".item")!;

    }

    /**
     * ***************************************************************************
     * Привязка узлов шаблона (выполняется один раз в конструкторе).
     *
     * Узлы кешируются на весь жизненный цикл строки: _setup() при каждой
     * перерисовке переиспользует кеш и больше не опрашивает DOM. Это важно,
     * потому что часть узлов (title/avatar/comments) по типу канала прячется
     * классом hidden — повторный querySelector их уже не нашёл бы, и любая
     * повторная отрисовка (например, снятие статуса «не отправлено» после
     * эха сервера) молча срывалась бы на guard'е.
     * @returns void
     * ***************************************************************************
     */
    _bindNodes(): void {

        // invariant: селекторы соответствуют шаблону _template() этого же
        // класса — узлы создаются вместе с элементом, non-null assertion
        // безопасен; при битом шаблоне падение поймает catch в _setup()
        this.block = this.element.querySelector<HTMLElement>(":scope >.block")!;
        this.presentation = this.element.querySelector<HTMLElement>(":scope >.block >.presentation")!;
        this.avatar = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.cdm-avatar")!;
        this.title = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap [data-title]")!;
        this.displayName = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap [data-display-name]")!;
        this.displayType = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap [data-display-type]")!;
        this.textWrap = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >.text-wrap")!;
        this.text = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >.text-wrap >[data-text]")!;
        this.status = this.element.querySelector<HTMLElement>(":scope [data-status]")!;
        this.createdAt = this.element.querySelector<HTMLElement>(":scope [data-status] >[data-created-at]")!;
        this.statusIcon = this.element.querySelector<HTMLElement>(":scope [data-status] >[data-status-icon]")!;
        this.attaches = this.element.querySelector<HTMLElement>(":scope attaches")!;
        this.buttons = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >buttons")!;
        this.comments = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >comments")!;

        // Счётчик и подпись вложены в обёртку <div> (отступ gap-1 между
        // иконкой и текстом) — ищем потомком comments, а не прямым ребёнком
        this.commentsCount = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >comments [data-count]")!;
        this.commentsText = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >comments [data-text]")!;
        this.reply = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >reply")!;
        this.forward = this.element.querySelector<HTMLElement>(":scope >.block >.presentation >.wrap-content >.wrap >forward")!;

    }

    /**
     * ***************************************************************************
     * Установка/Перерисовка данных.
     * @param data - Данные сообщения.
     * @returns void
     * ***************************************************************************
     */
    _setup(data: MessageData): void {

        try {

            // Сохраняем актуальные данные
            this.data = data;

            // Служебные иконки статуса (check/pencil) пересобираются
            // при каждой перерисовке; узлы уже закешированы в _bindNodes()
            this.statusIcon.innerHTML = "";

            // invariant: канал формы загружается с сервера до отрисовки списка
            const channel = this.form.channel;
            if (!channel) return;

            // Отображение элементов в зависимости от канала.
            // Ненужные узлы не удаляем, а прячем классом hidden: узлы
            // закешированы в конструкторе, а удалённый узел ломал повторные
            // перерисовки (повторный querySelector находил null и _setup
            // молча срывался, из-за чего сообщение не сбрасывало статус)
            if ([1, 5, 8].includes(channel.type)) {
                this.isTitle = false;
                this.title?.classList.add("hidden");
            }
            // Отображение элементов в зависимости от канала
            if ([1, 3, 5, 8].includes(channel.type)) {
                this.isAvatar = false;
                this.avatar?.classList.add("hidden");
            }

            // Время сообщения пересобирается при смене языка (Intl на новой локали)
            I18n.setTime(this.createdAt, data.created_at, "telegram-time");

            // Аватар
            if (this.isAvatar) {
                new Avatars({
                    element: this.avatar,
                    id: data.channel_type === 1 ? data.channel_id : data.created_user_id,
                    name: data.display_name,
                    image: data.avatar,
                    size: "xs"
                });
            }

            // Название (display_name опционален; undefined/null для textContent
            // эквивалентны — поле очищается)
            if (this.isTitle) {
                this.displayName.textContent = data.display_name ?? null;
            }

            // Если модератор или владелец
            if (data.is_moderator && (getSessionUserId() !== this.data.created_user_id)) {
                this.displayType.textContent = t("forms.messages.components.messages.moderator_badge");
            }

            // Если есть текст
            if (data.text) {

                this.textWrap?.classList.remove("hidden");

                // Берём рендерер для нужного варианта (бот/пользователь).
                // Экземпляр неизменяемый — правила отключены один раз при создании.
                const renderer = getMarkdownRenderer({ isBot: !!data.is_bot });

                // ВАЖНО (инвариант экранирования):
                // сервер отдаёт текст экранированным (EscapeHTML в get_data.js),
                // поэтому перед рендером мы его разэкранируем. MarkdownIt работает
                // с html:false — сырой HTML из сообщения попасть в DOM не может.
                // Не добавлять других путей записи в this.text.innerHTML.
                let unescapeText = unescapeHtml(data.text);

                // Текст
                this.text.innerHTML = renderer.render(unescapeText).trim();

                // Urlify
                urlify(this);

                // PreCodeActions
                preCodeActions(this);

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
            // (правило &.sticker в css/forms/messages.css, как у only-emoji/video-note)
            if (data.sticker_document_id && !data.text?.trim()) this.element.classList.add("sticker");

            // Устанавливаем атрибут
            this.element.setAttribute("data-id", data.id);

            // Ответ на сообщение
            if (this.data?.reply_to_message_id) {

                // Создаем ответ
                let replyWrap = createReply(this);

                // Очищаем контейнер и вставляем
                this.reply.innerHTML = "";
                this.reply.appendChild(replyWrap);

            }

            // Если пересланное
            if (this.data?.forwarded_to_message_id) {

                // Создаем ответ
                let forwardWrap = createForward(this);

                // Очищаем контейнер и вставляем
                this.forward.innerHTML = "";
                this.forward.appendChild(forwardWrap);

            }

            // Кнопки сообщения
            this.buttons.innerHTML = "";
            let buttonWrap = messageButtons(this.data);
            buttonWrap && this.buttons.appendChild(buttonWrap);

            // Если это группа, тема или диалог и сообщение пользователя
            if ([1, 2, 4, 6, 7, 8].includes(channel.type)) {
                if (data.created_user_id === getSessionUserId()) {
                    this.presentation.classList.add("justify-end");
                }
            }

            // Проверка статуса сообщения
            if (!this.data?.is_error_sending && !this.data.is_temporary) {

                // Если это диалог
                if (channel.type === 1 && (getSessionUserId() === this.data.created_user_id)) {

                    // Последнее просмотренное сообщение собеседника
                    const displayLastViewedId = channel.display_last_viewed_message_id;

                    // invariant: иконки check/checks входят в набор Icons —
                    // prepend не принимает null
                    if (!displayLastViewedId) {
                        this.statusIcon.prepend(Icons.icon("check")!);
                    } else if (displayLastViewedId < this.data.id) {
                        this.statusIcon.prepend(Icons.icon("check")!);
                    } else {
                        this.statusIcon.prepend(Icons.icon("checks", { classes: ["stroke-brand-600", "dark:stroke-brand-500"] })!);
                    }

                }

            }

            // Если сообщение не отправлено
            if (this.data.is_temporary) {

                if (!this.data.is_error_sending) {
                    this.element.classList.add("pending");

                    // invariant: иконка pencil-minus входит в набор Icons —
                    // prepend не принимает null
                    this.statusIcon.prepend(Icons.icon("pencil-minus")!);
                } else {
                    this.element.classList.add("error");

                    // invariant: иконка alert-triangle входит в набор Icons
                    this.statusIcon.prepend(Icons.icon("alert-triangle")!);
                }

            } else {
                this.element.classList.remove("pending");
                this.element.classList.remove("error");
            }

            // Служебный блок комментариев показываем только у постов сообществ
            // (канал type = 3) и только у отправленных сообщений: у temp-записи
            // id на сервере ещё нет, комментариев к ней быть не может.
            // toggle, а не add: _setup вызывается при каждой перерисовке, и
            // после эха сервера сообщение становится постоянным (channel_type = 3)
            // — блок обязан снова показаться
            const isCommentsVisible = data.channel_type === 3 && !data.is_temporary;
            this.comments?.classList.toggle("hidden", !isCommentsVisible);

            // Заполняем счётчик и подпись комментариев (склонение по числу)
            if (isCommentsVisible) this._updateCommentsCount();

            // Отображаем вложения
            messageAttaches(this);

            // Отображаем реакции
            messageReactions(this);

            // Если есть вложения
            // Переносим статус сообщения в attaches.
            // Проверяем через нормализатор: у temp/pending сообщений attachments —
            // объект-мап, и `.length` у него undefined, из-за чего статус
            // оставался в пустом text-wrap.
            if (Attachments.isNotEmpty(this.data?.attachments) && !data.text?.trim()) {
                this.attaches.appendChild(this.status);
            }

        } catch (error) {
            Logger.error(error);
        }

    }

    /**
     * ***************************************************************************
     * Заполнение счётчика и подписи комментариев в служебном блоке.
     *
     * Количество приходит с сервера (`count_comments`) и обновляется при пуше
     * `[comment]: new`/`[comment]: remove` через перерисовку строки. Подпись
     * склоняется по числу (1 комментарий / 2 комментария / 5 комментариев).
     * @returns void
     * ***************************************************************************
     */
    _updateCommentsCount(): void {

        // invariant: метод вызывается только когда блок комментариев видим
        // (см. _setup) — узлы закешированы в _bindNodes
        const count = this.data.count_comments ?? 0;

        // Счётчик и подпись — числом и склонённым словом из локализации
        this.commentsCount.textContent = String(count);
        this.commentsText.textContent = t("forms.messages.components.messages.comments.dec_comments", { count });

    }

    /**
     * ***************************************************************************
     * Обработчики: жесты строки (тап, долгий тап, свайп влево → ответ).
     * @returns void
     * ***************************************************************************
     */
    _actions(): void {

        // Открытие формы комментариев по клику на строку комментариев.
        // Строка рисуется только для постов сообществ (channel_type = 3),
        // поэтому отдельной проверки здесь не требуется
        this.comments?.addEventListener("click", (event) => {

            // Тап по строке не должен дёргать контекстное меню/жесты строки
            event.stopPropagation();

            // Форма комментариев живёт в своём реестре по id поста
            new Comments({
                postId: this.data.id,
                channelId: this.data.channel_id ?? this.form.channelId
            });

        });

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
                    // Это позволит браузеру выстрелить обычный 'click', который поймает ваш Urlify.
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
    update(data: MessageData): void {

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

            // Перед переподпиской вызываем старые функции очистки, если они уже существовали (важно при смене ID)
            if (this.unsubscribe.updated) this.unsubscribe.updated();
            if (this.unsubscribe.idChanged) this.unsubscribe.idChanged();

            // Формируем уникальное имя события
            let itemUpdatedEvent: StoreEventName = `item::updated::${this.data.id}`;

            // Подписываемся и сохраняем функцию отписки
            this.unsubscribe.updated = this.form.store.on(itemUpdatedEvent, async (data) => {

                // Store.update() эмитит событие даже если элемента нет в Map —
                // в этом случае data === undefined, и перерисовка упала бы в catch.
                if (!data) return;

                // invariant: событие item::updated отдаёт данные этого сообщения
                this.update(data as MessageData);

            });

            // ===================================================

            // Подписка на смену ID
            const idChangeEventName: StoreEventName = `item::id-changed::${this.data.id}`;
            this.unsubscribe.idChanged = this.form.store.on(idChangeEventName, (payload) => {

                // invariant: событие item::id-changed отдаёт StoreIdChange с этим элементом
                const changed = payload as StoreIdChange & { item: MessageData };

                // Обновляем данные компонента (включая this.data.id)
                this.data = changed.item;

                // Обновляем атрибут data-id в DOM-элементе
                this.element.setAttribute("data-id", String(changed.newId));

                // Вызываем переподписку
                // Это автоматически отпишется от старых событий (this.data.id)
                // и подпишется на новые (newId).
                this._subscribeToUpdates();

            });

            // Сохраняем объединенную функцию отписки для внешнего вызова из Main (групповой деструктор элементов)
            this.data.__unsubscribeStore__ = () => {
                if (this.unsubscribe.updated) this.unsubscribe.updated();
                if (this.unsubscribe.idChanged) this.unsubscribe.idChanged();
            };

        } catch (error) {
            Logger.error(error);
        }

    }

    /**
     * ***************************************************************************
     * Обновление статуса сообщения (прочитано собеседником).
     * @returns void
     * ***************************************************************************
     */
    _updateStatusRead(): void {

        // Удаляем иконку
        this.statusIcon.innerHTML = "";

        // invariant: канал формы загружается с сервера до отрисовки сообщений
        const channel = this.form.channel;
        if (!channel) return;

        // Проверка статуса сообщения
        if (channel.type === 1 && (getSessionUserId() === this.data.created_user_id)) {

            // При отсутствии id сравнение пропускаем (проверка явная):
            // invariant: иконки check/checks входят в набор Icons
            const lastViewedId = channel.display_last_viewed_message_id;
            if (lastViewedId != null && lastViewedId < this.data.id) {
                this.statusIcon.prepend(Icons.icon("check")!);
            } else {
                this.statusIcon.prepend(Icons.icon("checks", { classes: ["stroke-brand-600", "dark:stroke-brand-500"] })!);
            }
        }

    }

    /**
     * ***************************************************************************
     * Обновление реакций сообщения.
     * @param reactions - Новый список реакций.
     * @returns void
     * ***************************************************************************
     */
    _updateReactions(reactions?: MessageReaction[] | null): void {

        // Обновляем данные
        this.data.reactions = reactions || [];

        // Отображаем реакции
        messageReactions(this);

    }

}

/**
 * ***************************************************************************
 * createMessageItem - фабрика строки сообщения: единая точка входа для
 * Store-ивентов. Системное сообщение уходит в свою фабрику, обычное
 * собирается классом — наружу возвращается готовый DOM-узел.
 * @param form - Экземпляр формы.
 * @param data - Данные сообщения.
 * @returns DOM-элемент сообщения.
 * ***************************************************************************
 */
export function createMessageItem(form: Messages, data: MessageData): HTMLElement {

    // Если это системное сообщение
    if (data?.action_type) {

        // Уходим в системное сообщение
        return createSystemMessage(data);

    }

    // Обычная строка: возвращаем элемент экземпляра
    return new MessageItem(form, data).element;

}
