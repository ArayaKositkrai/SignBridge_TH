from app.services.retrieval_service import load_vocabulary


# ตัดข้อความภาษาไทยเป็นคำ (ตอนนี้จับคู่กับคลังคำศัพท์แบบยาวสุดก่อน)
def tokenize(text: str) -> list[str]:
    """Placeholder tokenizer: greedy longest-match against the vocabulary.

    Replace with PyThaiNLP word_tokenize once the dependency is added.
    """
    words = sorted(load_vocabulary(), key=len, reverse=True)
    tokens: list[str] = []
    i = 0
    text = text.replace(" ", "")
    while i < len(text):
        match = next((w for w in words if text.startswith(w, i)), None)
        if match:
            tokens.append(match)
            i += len(match)
        else:
            i += 1
    return tokens
