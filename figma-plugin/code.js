figma.showUI(__html__, { width: 440, height: 480 });

var STYLE = {
  numberFontSize: 40,
  boxTitleFontSize: 40,
  boxTitleFontSizeCompare: 40,
  boxTitleFontSizeKeyword: 40,
  boxBodyFontSize: 40,
  boxBodyFontSizeCompare: 40,
  boxBodyFontSizeKeyword: 40,
  arrowFontSize: 40,
  boxGap: 20,
  compareGap: 20,
  keywordGap: 20,

  minBoxTitleFontSize: 48,
  minBoxBodyFontSize: 40,

  flowTitleFontSize: 40,
  flowBodyFontSize: 40,
  flowMinTitleFontSize: 40,
  flowMinBodyFontSize: 40,
  flowNumberFontSize: 40,
  flowArrowFontSize: 40,
  flowArrowHeight: 24
};

var TEXT_LIMITS = {
  coverTitleLine: 10,
  middleTitleLine: 12,
  middleSubtitle: 26,
  listTitle: 12,
  listBody: 28,
  compareTitle: 8,
  compareBody: 20,
  flowTitle: 10,
  flowBody: 22,
  keyTitle: 16,
  keyBody: 34
};

var BOX_ACCENTS = [
  { bar: "#00AEEF", bg: "#EBF8FF", title: "#006B8F" },
  { bar: "#6366F1", bg: "#EEF2FF", title: "#4338CA" },
  { bar: "#14B8A6", bg: "#F0FDFA", title: "#0D9488" },
];

var FIGMA_THEMES = {
  default: { first: "Instagram post - first", cta: "Instagram post - CTA" },
  summer:  { first: "summer_first",  cta: "summer_CTA"  },
  summer1: { first: "summer1_first", cta: "summer1_CTA" },
  summer2: { first: "summer2_first", cta: "summer2_CTA" },
  summer3: { first: "summer3_first", cta: "summer3_CTA" },
  summer4: { first: "summer4_first", cta: "summer4_CTA" },
  summer5: { first: "summer5_first", cta: "summer5_CTA" },
  week2:   { first: "week2_first",   cta: "week2_CTA"   },
};

function applyThemeToCards(cards, theme) {
  var t = FIGMA_THEMES[theme] || FIGMA_THEMES["default"];
  return cards.map(function(card) {
    var name = card.template_name;
    // 기존 summer 변형 이름(summer1_first 등)도 포함해서 교체
    if (name === "Instagram post - first" || name.endsWith("_first")) {
      return Object.assign({}, card, { template_name: t.first });
    }
    if (name === "Instagram post - CTA" || name.endsWith("_CTA")) {
      return Object.assign({}, card, { template_name: t.cta });
    }
    return card;
  });
}

figma.ui.onmessage = async function (msg) {
  if (msg.type !== "create-cards") return;

  try {
    var parsed;

    try {
      var rawText = msg.jsonText.trim();

      // AI 서문 + 코드펜스 패턴 처리: "설명 텍스트\n\n```json\n{...}\n```"
      var fenceMatch = rawText.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
      if (fenceMatch) {
        rawText = fenceMatch[1].trim();
      } else if (rawText.startsWith("```")) {
        // 앞쪽 코드펜스만 있는 경우
        var lines = rawText.split("\n");
        var closeIdx = lines.findIndex(function(l, i) { return i > 0 && /^```/.test(l.trim()); });
        rawText = (closeIdx > 0 ? lines.slice(1, closeIdx) : lines.slice(1)).join("\n").trim();
      }

      // 그래도 JSON이 아닌 경우 첫 { 또는 [ 위치부터 시도
      if (!rawText.startsWith("{") && !rawText.startsWith("[")) {
        var firstBrace = rawText.indexOf("{");
        var firstBracket = rawText.indexOf("[");
        var startPos = -1;
        if (firstBrace !== -1 && firstBracket !== -1) {
          startPos = Math.min(firstBrace, firstBracket);
        } else if (firstBrace !== -1) {
          startPos = firstBrace;
        } else if (firstBracket !== -1) {
          startPos = firstBracket;
        }
        if (startPos !== -1) rawText = rawText.slice(startPos);
      }

      parsed = JSON.parse(rawText);
    } catch (e) {
      throw new Error("JSON 형식이 올바르지 않습니다. 앱에서 생성된 JSON을 그대로 붙여넣어 주세요.");
    }

    // 앱 JSON 최상위 구조 ({ planning, content_title, cards[] }) 또는 cards 배열 직접 지원
    var cards = Array.isArray(parsed) ? parsed : (parsed.cards || null);

    if (!cards || !Array.isArray(cards)) {
      throw new Error("cards 배열을 찾을 수 없습니다. 앱에서 생성된 전체 JSON을 붙여넣어 주세요.");
    }

    if (cards.length === 0) {
      throw new Error("cards가 0개입니다. 콘텐츠를 먼저 생성해 주세요.");
    }

    // 항상 테마 치환 적용 (default도 처리, 기존 summer 이름도 교체 가능)
    cards = applyThemeToCards(cards, msg.theme || "default");

    figma.ui.postMessage({
      type: "status",
      message: "Figma 카드 프레임을 생성하는 중입니다..."
    });

    var createdFrames = await createCards(cards);

    if (!createdFrames || createdFrames.length === 0) {
      throw new Error("카드 데이터는 있었지만 Figma 프레임 생성에 실패했습니다.");
    }

    figma.currentPage.selection = createdFrames;
    figma.viewport.scrollAndZoomIntoView(createdFrames);

    figma.ui.postMessage({
      type: "status",
      message: "카드뉴스 생성 완료: " + createdFrames.length + "장"
    });

    figma.ui.postMessage({ type: "button-enabled" });

    figma.notify("카드뉴스 생성 완료: " + createdFrames.length + "장");
  } catch (error) {
    figma.ui.postMessage({
      type: "status",
      message: "오류: " + error.message
    });

    figma.ui.postMessage({ type: "button-enabled" });

    figma.notify("오류: " + error.message);
  }
};

async function createCards(cards) {
  var createdFrames = [];
  var gap = 80;
  var batchKey = getDateTimeKey();

  // "Instagram post - first" 템플릿이 있는 페이지를 자동으로 찾음 (어느 페이지에서 실행해도 동작)
  var templatePage = figma.currentPage;
  var outputPage = figma.currentPage;

  for (var pi = 0; pi < figma.root.children.length; pi++) {
    var p = figma.root.children[pi];
    if (p.name === "결과물") {
      outputPage = p;
    }
    // 템플릿 페이지: "Instagram post - first" FRAME이 있는 페이지
    if (p.findOne(function(n) { return n.type === "FRAME" && n.name === "Instagram post - first"; })) {
      templatePage = p;
    }
  }

  // 결과물 페이지 기준 배치 위치 계산
  var position = getPageStartPosition(outputPage);
  var x = position.x;
  var y = position.y;

  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var cardTemplateName = card.template_name;

    // summer1_first, summer1_CTA 등 여름 변형은 해당 프레임을 직접 클론
    // Instagram post - first/CTA/middle은 그대로 클론
    var template = templatePage.findOne(function (node) {
      return node.type === "FRAME" && node.name === cardTemplateName;
    });

    if (!template) {
      throw new Error("템플릿 프레임을 찾을 수 없습니다: " + cardTemplateName);
    }

    var clone = template.clone();
    templatePage.appendChild(clone);
    clone.visible = true;
    clone.locked = false;

    await setLayerText(clone, "cloud_label", card.cloud_label || "");
    await setLayerText(clone, "series_title", card.series_title || "");

    if (card.template_name === "Instagram post - first" || cardTemplateName.endsWith("_first")) {
      var rawCoverTitle = String(card.title || "").replace(/\r/g, "");
      var coverTitle = rawCoverTitle.indexOf("\n") !== -1
        ? rawCoverTitle
        : wrapTitleByMaxChars(rawCoverTitle, TEXT_LIMITS.coverTitleLine);
      await setLayerText(clone, "title", coverTitle);

      await setLayerText(clone, "subtitle", card.subtitle || "");
    }

    if (card.template_name === "Instagram post - middle") {
      var rawTitle = String(card.title || "").replace(/\r/g, "");
      // AI가 생성한 줄을 하나로 합친 뒤 12자 단위로 재분할 → 최대 2줄 강제
      var titleOneLine = rawTitle.split("\n")
        .map(function(p) { return p.trim(); })
        .filter(Boolean)
        .join(" ");
      var wrappedLines = wrapTitleByMaxChars(titleOneLine, 12).split("\n");
      var middleTitle = wrappedLines.slice(0, 2).join("\n");

      var middleSubtitle = forceSingleLineText(card.subtitle || "");
      var middleHighlight = getMiddleHighlight(
        middleTitle,
        card.highlight_text || ""
      );

      if (middleHighlight) {
        await setStyledTitle(clone, "title", middleTitle, middleHighlight);
      } else {
        await setLayerText(clone, "title", middleTitle);
      }

      await setLayerText(clone, "subtitle", middleSubtitle);
    }

    // CTA 템플릿은 텍스트 레이어만 채우고 디자인은 유지
    if (card.template_name === "Instagram post - CTA" || cardTemplateName.endsWith("_CTA")) {
      if (card.title) {
        await setLayerText(clone, "title", card.title);
      }
      if (card.subtitle) {
        await setLayerText(clone, "subtitle", card.subtitle);
      }
      if (card.cta) {
        await setLayerText(clone, "cta", card.cta);
      }
    }

    await renderDynamicBlocks(clone, card);

    // 완성된 클론을 결과물 페이지로 이동 후 위치 지정
    outputPage.appendChild(clone);
    clone.name = "card" + card.card_no + "_" + batchKey;
    clone.x = x;
    clone.y = y;

    createdFrames.push(clone);
    x += clone.width + gap;
  }

  // 결과물 페이지로 전환
  if (outputPage !== templatePage) {
    await figma.setCurrentPageAsync(outputPage);
  }

  return createdFrames;
}

// 특정 페이지의 기존 프레임 아래쪽에 새 배치 위치 계산
function getPageStartPosition(page) {
  var frames = page.children.filter(function (node) {
    return node.type === "FRAME";
  });

  if (!frames.length) {
    return { x: 0, y: 0 };
  }

  var minX = Infinity;
  var maxY = -Infinity;

  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    if (frame.x < minX) minX = frame.x;
    if (frame.y + frame.height > maxY) maxY = frame.y + frame.height;
  }

  if (minX === Infinity) minX = 0;
  if (maxY === -Infinity) maxY = 0;

  return { x: minX, y: maxY + 180 };
}

function getNextStartPosition() {
  return getPageStartPosition(figma.currentPage);
}

// FRAME 또는 자식 레이어에서 IMAGE fill 반환 (summer 템플릿 사진 배경 추출용)
function getImageFills(node) {
  if (node.fills && node.fills.length > 0) {
    var hasImage = node.fills.some(function(f) { return f.type === "IMAGE"; });
    if (hasImage) return node.fills;
  }
  // FRAME에 직접 fill이 없으면 자식 레이어에서 검색
  if (node.children) {
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (child.fills && child.fills.length > 0) {
        var childHasImage = child.fills.some(function(f) { return f.type === "IMAGE"; });
        if (childHasImage) return child.fills;
      }
    }
  }
  return null;
}

function getDateTimeKey() {
  var now = new Date();

  var year = String(now.getFullYear());
  var month = String(now.getMonth() + 1).padStart(2, "0");
  var date = String(now.getDate()).padStart(2, "0");
  var hour = String(now.getHours()).padStart(2, "0");
  var minute = String(now.getMinutes()).padStart(2, "0");
  var second = String(now.getSeconds()).padStart(2, "0");

  return year + month + date + "_" + hour + minute + second;
}

async function setLayerText(parent, layerName, value) {
  var node = parent.findOne(function (child) {
    return child.type === "TEXT" && child.name === layerName;
  });

  if (!node) return;

  var fontName = node.fontName === figma.mixed
    ? { family: "Inter", style: "Regular" }
    : node.fontName;

  await figma.loadFontAsync(fontName);
  node.characters = value || "";
}

async function setTitleWithLineLimit(parent, layerName, value, maxCharsPerLine) {
  var node = parent.findOne(function (child) {
    return child.type === "TEXT" && child.name === layerName;
  });

  if (!node) return;

  var fontName = node.fontName === figma.mixed
    ? { family: "Inter", style: "Regular" }
    : node.fontName;

  await figma.loadFontAsync(fontName);

  node.characters = wrapTitleByMaxChars(value || "", maxCharsPerLine);
  node.textAutoResize = "HEIGHT";
}

async function setStyledTitle(parent, layerName, fullText, highlightText) {
  var node = parent.findOne(function (child) {
    return child.type === "TEXT" && child.name === layerName;
  });

  if (!node) return;

  var fontName = node.fontName === figma.mixed
    ? { family: "Inter", style: "Regular" }
    : node.fontName;

  await figma.loadFontAsync(fontName);

  node.characters = fullText || "";
  node.textAutoResize = "HEIGHT";

  if (!highlightText) return;

  // \n 정규화 후 위치 탐색 (줄바꿈이 하이라이트 중간에 있어도 같은 char offset이므로 그대로 사용 가능)
  var flatFull = fullText.replace(/\n/g, " ");
  var flatHL = String(highlightText).replace(/\n/g, " ");
  var start = flatFull.indexOf(flatHL);

  if (start === -1) return;

  var end = start + highlightText.length;

  node.setRangeFills(start, end, [
    { type: "SOLID", color: hexToRgb("#00AEEF") }
  ]);
}

function getMiddleHighlight(fullText, highlightText) {
  var title = String(fullText || "");
  var highlight = String(highlightText || "").trim();
  // \n을 공백으로 정규화해서 비교 (줄바꿈이 하이라이트 중간에 끼어도 매칭)
  var flatTitle = title.replace(/\n/g, " ");
  var flatHL = highlight.replace(/\n/g, " ");

  if (flatHL && flatTitle.indexOf(flatHL) !== -1) {
    return highlight;
  }

  // highlight_text가 없을 경우 키워드 fallback
  var candidates = [
    "역할 분리가", "역할 분리", "문의 유형을", "문의 유형",
    "AI와 상담사가", "AI와 상담사", "AI 챗봇만으로는", "AI 챗봇",
    "CS쉐어링 AI CX", "AI CX", "반복 문의", "예외 문의",
    "운영 흐름", "문의 분류", "상담사 연결", "VOC 분석", "VOC"
  ];

  for (var i = 0; i < candidates.length; i++) {
    if (title.indexOf(candidates[i]) !== -1) {
      return candidates[i];
    }
  }

  return "";
}

async function renderDynamicBlocks(frame, card) {
  var container = frame.findOne(function (node) {
    return node.name === "block_container";
  });

  if (!container) return;

  if (container.type !== "FRAME") {
    throw new Error("block_container는 Rectangle이 아니라 Frame이어야 합니다.");
  }

  var oldChildren = [];

  for (var i = 0; i < container.children.length; i++) {
    oldChildren.push(container.children[i]);
  }

  for (var j = 0; j < oldChildren.length; j++) {
    oldChildren[j].remove();
  }

  var items = Array.isArray(card.items) ? card.items : [];

  if (!items.length) return;

  var aliases = {
    stacked_boxes: "list_cards",
    steps_vertical: "numbered_signals"
  };

  var layoutType = aliases[card.layout_type] || card.layout_type || "list_cards";

  if (card.layout_type === "keyword_boxes") {
    await renderGridCards(container, items, frame);
    return;
  }

  if (layoutType === "compare_2col") {
    await renderCompareBlocks(container, items, frame);
    return;
  }

  if (layoutType === "flow_process") {
    await renderFlowBlocks(container, items, frame);
    return;
  }

  if (layoutType === "numbered_signals") {
    await renderNumberedSignals(container, items, frame);
    return;
  }

  if (layoutType === "key_message") {
    await renderKeyMessage(container, items, frame);
    return;
  }

  await renderListCards(container, items, frame, card.card_no || 0);
}

async function renderCompareBlocks(container, items, frame) {
  var gap = STYLE.compareGap;
  var maxItems = Math.min(items.length, 2);
  var boxWidth = (container.width - gap) / 2;
  var boxHeight = container.height;

  for (var i = 0; i < maxItems; i++) {
    await createTextBlock(
      container, items[i],
      i * (boxWidth + gap), 0,
      boxWidth, boxHeight,
      "compare_2col", frame
    );
  }
}

async function renderListCards(container, items, frame, cardAccentIndex) {
  var maxItems = Math.min(items.length, 4);
  var gap = STYLE.boxGap;
  var boxHeight = Math.floor((container.height - gap * (maxItems - 1)) / maxItems);

  for (var i = 0; i < maxItems; i++) {
    await createTextBlock(
      container, items[i],
      0, i * (boxHeight + gap),
      container.width, boxHeight,
      "list_cards", frame,
      cardAccentIndex || 0
    );
  }
}

// keyword_boxes 전용: 4x1 세로 나열이 아니라 2열 그리드(2x2, 3개면 2+1)로 배치.
// 박스 자체 스타일(강조선·색상)은 list_cards와 동일하게 재사용한다.
async function renderGridCards(container, items, frame) {
  var maxItems = Math.min(items.length, 4);
  var cols = 2;
  var rows = Math.ceil(maxItems / cols);
  var gap = STYLE.boxGap;

  var boxWidth = Math.floor((container.width - gap * (cols - 1)) / cols);
  var boxHeight = Math.floor((container.height - gap * (rows - 1)) / rows);

  for (var i = 0; i < maxItems; i++) {
    var col = i % cols;
    var row = Math.floor(i / cols);

    await createTextBlock(
      container, items[i],
      col * (boxWidth + gap), row * (boxHeight + gap),
      boxWidth, boxHeight,
      "list_cards", frame,
      i
    );
  }
}

async function renderNumberedSignals(container, items, frame) {
  var maxItems = Math.min(items.length, 3);
  var gap = STYLE.boxGap;
  var boxHeight = Math.floor((container.height - gap * (maxItems - 1)) / maxItems);

  for (var i = 0; i < maxItems; i++) {
    var signalItem = Object.assign({}, items[i] || {});
    signalItem.number = signalItem.number || String(i + 1).padStart(2, "0");

    await createTextBlock(
      container, signalItem,
      0, i * (boxHeight + gap),
      container.width, boxHeight,
      "numbered_signals", frame
    );
  }
}

async function renderKeyMessage(container, items, frame) {
  var maxItems = Math.min(items.length, 3);

  if (maxItems < 2) {
    await renderListCards(container, items, frame);
    return;
  }

  var gap = STYLE.boxGap;
  var topHeight = Math.floor(container.height * 0.54);
  var bottomHeight = container.height - topHeight - gap;

  await createTextBlock(
    container, items[0],
    0, 0,
    container.width, topHeight,
    "key_message_main", frame
  );

  if (maxItems === 2) {
    await createTextBlock(
      container, items[1],
      0, topHeight + gap,
      container.width, bottomHeight,
      "key_message_sub", frame
    );
    return;
  }

  var boxWidth = Math.floor((container.width - gap) / 2);

  for (var i = 1; i < 3; i++) {
    await createTextBlock(
      container, items[i],
      (i - 1) * (boxWidth + gap), topHeight + gap,
      boxWidth, bottomHeight,
      "key_message_sub", frame
    );
  }
}

async function renderFlowBlocks(container, items, frame) {
  var maxItems = Math.min(items.length, 4);
  var gap = 60;
  var minBoxHeight = 146;
  var boxHeight = Math.max(
    Math.min(
      Math.floor((container.height - gap * (maxItems - 1)) / maxItems),
      230
    ),
    minBoxHeight
  );

  var totalHeight = maxItems * boxHeight + (maxItems - 1) * gap;
  if (totalHeight > container.height) {
    container.resize(container.width, totalHeight);
  }

  for (var i = 0; i < maxItems; i++) {
    var blockY = i * (boxHeight + gap);

    await createTextBlock(
      container, items[i],
      0, blockY,
      container.width, boxHeight,
      "flow_process", frame
    );

    if (i < maxItems - 1) {
      var arrow = figma.createText();

      arrow.name = "generated_flow_arrow";

      await applyFont(arrow, getFontFromLayer(frame, "title"));

      arrow.characters = "↓";
      arrow.fontSize = STYLE.flowArrowFontSize;
      arrow.textAlignHorizontal = "CENTER";
      arrow.textAlignVertical = "CENTER";
      arrow.fills = [{ type: "SOLID", color: hexToRgb("#00AEEF") }];

      arrow.resize(container.width, gap);
      arrow.x = 0;
      arrow.y = blockY + boxHeight;

      container.appendChild(arrow);
    }
  }
}

async function createTextBlock(container, item, x, y, width, height, layoutType, frame, itemIndex) {
  item = item || {};
  itemIndex = itemIndex || 0;

  var isFlow = layoutType === "flow_process";
  var isListCard = layoutType === "list_cards";
  var accent = isListCard ? BOX_ACCENTS[itemIndex % BOX_ACCENTS.length] : null;

  var box = figma.createFrame();

  box.name = "generated_block";
  box.x = x;
  box.y = y;
  box.resize(width, height);
  box.fills = [{ type: "SOLID", color: hexToRgb(accent ? accent.bg : "#FFFFFF") }];
  box.strokes = accent ? [] : [{ type: "SOLID", color: hexToRgb("#E5E7EB") }];
  box.strokeWeight = 1;
  box.cornerRadius = 18;
  box.clipsContent = isListCard;

  container.appendChild(box);

  if (isListCard) {
    var bar = figma.createFrame();
    bar.name = "generated_accent_bar";
    bar.x = 0;
    bar.y = 0;
    bar.resize(10, height);
    bar.fills = [{ type: "SOLID", color: hexToRgb(accent.bar) }];
    bar.cornerRadius = 0;
    box.appendChild(bar);
  }

  var showNumber = !!item.number;

  var barOffset = isListCard ? 10 : 0;
  var textLeft = 24 + barOffset;
  var topPadding = isFlow ? 20 : 22;
  var bodyTop = isFlow ? 86 : 84;

  if (showNumber) {
    var badgeSize = isFlow ? 40 : 58;
    var badgeRadius = isFlow ? 10 : 14;

    var badge = figma.createFrame();

    badge.name = "generated_number_badge";
    badge.x = isFlow ? 18 : 22;
    badge.y = 22;
    badge.resize(badgeSize, badgeSize);
    badge.fills = [{ type: "SOLID", color: hexToRgb("#00AEEF") }];
    badge.cornerRadius = badgeRadius;
    badge.clipsContent = false;

    box.appendChild(badge);

    var numberText = figma.createText();

    numberText.name = "generated_number";

    await applyFont(numberText, getFontFromLayer(frame, "title"));

    numberText.characters = String(item.number || "");
    numberText.fontSize = isFlow ? STYLE.flowNumberFontSize : STYLE.numberFontSize;
    numberText.fills = [{ type: "SOLID", color: hexToRgb("#FFFFFF") }];
    numberText.textAlignHorizontal = "CENTER";
    numberText.textAlignVertical = "CENTER";
    numberText.resize(badgeSize, badgeSize);
    numberText.x = 0;
    numberText.y = 0;

    badge.appendChild(numberText);

    textLeft = isFlow ? 70 : 98;
    topPadding = isFlow ? 22 : 24;
    bodyTop = isFlow ? 80 : 92;
  }

  var titleText = figma.createText();

  titleText.name = "generated_block_title";
  titleText.x = textLeft;
  titleText.y = topPadding;
  titleText.fills = [{ type: "SOLID", color: hexToRgb("#333333") }];

  box.appendChild(titleText);

  await applyFont(titleText, getFontFromLayer(frame, "subtitle"));

  titleText.characters = item.title || "";

  if (layoutType === "flow_process") {
    titleText.fontSize = STYLE.flowTitleFontSize;
  } else if (layoutType === "compare_2col") {
    titleText.fontSize = STYLE.boxTitleFontSizeCompare;
  } else if (layoutType === "key_message_main") {
    titleText.fontSize = STYLE.boxTitleFontSizeKeyword;
  } else {
    titleText.fontSize = STYLE.boxTitleFontSize;
  }

  titleText.textAutoResize = "HEIGHT";
  titleText.lineHeight = { unit: "PIXELS", value: titleText.fontSize * 1.16 };
  titleText.resize(width - textLeft - 24, 10);

  var bodyText = figma.createText();

  bodyText.name = "generated_block_body";
  bodyText.x = textLeft;
  bodyText.y = bodyTop;
  bodyText.fills = [{ type: "SOLID", color: hexToRgb("#666666") }];

  box.appendChild(bodyText);

  await applyFont(bodyText, getFontFromLayer(frame, "subtitle"));

  bodyText.characters = item.body || "";

  if (layoutType === "flow_process") {
    bodyText.fontSize = STYLE.flowBodyFontSize;
  } else if (layoutType === "compare_2col") {
    bodyText.fontSize = STYLE.boxBodyFontSizeCompare;
  } else if (layoutType === "key_message_main") {
    bodyText.fontSize = STYLE.boxBodyFontSizeKeyword;
  } else {
    bodyText.fontSize = STYLE.boxBodyFontSize;
  }

  bodyText.textAutoResize = "HEIGHT";
  bodyText.lineHeight = { unit: "PIXELS", value: bodyText.fontSize * 1.2 };
  var bottomPad = isFlow ? 28 : 14;
  bodyText.resize(width - textLeft - 24, height - bodyTop - bottomPad);

  fitTextsInsideBlock(titleText, bodyText, width, height, textLeft, topPadding, bodyTop, layoutType);
}

function fitTextsInsideBlock(titleText, bodyText, boxWidth, boxHeight, textLeft, topPadding, bodyTop, layoutType) {
  var titleMaxWidth = boxWidth - textLeft - 24;
  var bodyMaxWidth = boxWidth - textLeft - 24;
  var titleMaxHeight = bodyTop - topPadding - 6;
  var bottomPadFit = layoutType === "flow_process" ? 28 : 14;
  var bodyMaxHeight = boxHeight - bodyTop - bottomPadFit;

  if (titleMaxWidth <= 0 || bodyMaxWidth <= 0 || titleMaxHeight <= 0 || bodyMaxHeight <= 0) {
    return;
  }

  var minTitleFontSize = layoutType === "flow_process"
    ? STYLE.flowMinTitleFontSize
    : STYLE.minBoxTitleFontSize;

  var minBodyFontSize = layoutType === "flow_process"
    ? STYLE.flowMinBodyFontSize
    : STYLE.minBoxBodyFontSize;

  titleText.resize(titleMaxWidth, titleMaxHeight);
  bodyText.resize(bodyMaxWidth, bodyMaxHeight);

  while (titleText.height > titleMaxHeight && titleText.fontSize > minTitleFontSize) {
    titleText.fontSize = titleText.fontSize - 1;
    titleText.lineHeight = { unit: "PIXELS", value: titleText.fontSize * 1.16 };
    titleText.resize(titleMaxWidth, titleMaxHeight);
  }

  while (bodyText.height > bodyMaxHeight && bodyText.fontSize > minBodyFontSize) {
    bodyText.fontSize = bodyText.fontSize - 1;
    bodyText.lineHeight = { unit: "PIXELS", value: bodyText.fontSize * 1.2 };
    bodyText.resize(bodyMaxWidth, bodyMaxHeight);
  }
}

function getFontFromLayer(parent, layerName) {
  var node = parent.findOne(function (child) {
    return child.type === "TEXT" && child.name === layerName;
  });

  if (!node || node.fontName === figma.mixed) {
    return { family: "Inter", style: "Regular" };
  }

  return node.fontName;
}

async function applyFont(textNode, fontName) {
  try {
    await figma.loadFontAsync(fontName);
    textNode.fontName = fontName;
  } catch (error) {
    var fallback = { family: "Inter", style: "Regular" };

    await figma.loadFontAsync(fallback);
    textNode.fontName = fallback;
  }
}

function hexToRgb(hex) {
  var clean = hex.replace("#", "");

  var r = parseInt(clean.substring(0, 2), 16) / 255;
  var g = parseInt(clean.substring(2, 4), 16) / 255;
  var b = parseInt(clean.substring(4, 6), 16) / 255;

  return { r: r, g: g, b: b };
}

function wrapTitleByMaxChars(text, maxChars) {
  var clean = String(text || "")
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";

  var lines = [];
  var remaining = clean;

  while (remaining.length > maxChars) {
    var cutIndex = maxChars;
    var lastSpace = remaining.lastIndexOf(" ", maxChars);

    if (lastSpace >= Math.ceil(maxChars * 0.55)) {
      cutIndex = lastSpace;
    }

    var line = remaining.slice(0, cutIndex).trim();

    if (line) lines.push(line);

    remaining = remaining.slice(cutIndex).trim();
  }

  if (remaining) lines.push(remaining);

  return lines.join("\n");
}

function forceSingleLineText(text) {
  if (!text) return "";

  return String(text)
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
