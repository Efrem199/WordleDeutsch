#!/usr/bin/env python3
"""
Builds 5-letter German word lists for the Wordle/Quordle site.

Sources (see README "Источники данных"):
  * dictionary-de (npm, Hunspell de_DE / igerman98, GPLv2/GPLv3):
    base words + affix rules -> all inflected forms (valid guesses).
  * FrequencyWords (hermitdave, MIT, OpenSubtitles 2016 de):
    used to pick common words as possible answers.

Usage:
  python3 tools/build_wordlists.py <path-to-dic> <path-to-aff> <path-to-freq> <out-dir>
"""
import re
import sys
import json
import os
import unicodedata

# Немецкий алфавит: a–z + ÄÖÜ + ß (ß есть на клавиатуре игры)
LETTERS = re.compile(r"^[a-zäöüß]{5}$")


def norm(w):
    return unicodedata.normalize("NFC", w).lower()


def parse_aff(path):
    """Parse PFX/SFX rule lines: TYPE FLAG STRIP ADD [CONDITION].
    Header lines (TYPE FLAG CROSS COUNT) have a numeric 4th field and are skipped."""
    pfx, sfx = {}, {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 4 or parts[0] not in ("PFX", "SFX"):
                continue
            if len(parts) == 4 and parts[3].isdigit():
                continue  # header
            kind, flag, strip, add = parts[0], parts[1], parts[2], parts[3]
            cond = parts[4] if len(parts) > 4 else "."
            strip = "" if strip == "0" else strip
            add = "" if add == "0" else add
            target = pfx if kind == "PFX" else sfx
            target.setdefault(flag, []).append((strip, add, cond))
    return pfx, sfx


def cond_match(word, cond, is_prefix):
    if cond == ".":
        return True
    if is_prefix:
        pat = "^" + cond
        # condition for prefixes tests the start of the stem
        return re.search(pat, word) is not None
    return re.search(cond + "$", word) is not None


def expand(stem, flags, pfx, sfx):
    out = {stem}
    suffixed = set()
    for fl in flags:
        for strip, add, cond in sfx.get(fl, []):
            if not cond_match(stem, cond, False):
                continue
            base = stem[: len(stem) - len(strip)] if strip else stem
            w = base + add
            out.add(w)
            suffixed.add(w)
    for fl in flags:
        for strip, add, cond in pfx.get(fl, []):
            if not cond_match(stem, cond, True):
                continue
            base = stem[len(strip):] if strip else stem
            out.add(add + base)
    return out


ANSWER_POOL_SIZE = 950  # top-ranked candidates considered for answers (after blacklist)


def main():
    dic_path, aff_path, freq_path, out_dir = sys.argv[1:5]
    bl_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "answer_blacklist.txt")
    blacklist = set()
    with open(bl_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                blacklist.add(norm(line))
    pfx, sfx = parse_aff(aff_path)

    lemmas = set()
    forms = set()
    with open(dic_path, encoding="utf-8", errors="replace") as f:
        first = True
        for line in f:
            line = line.rstrip("\n")
            if first:
                first = False
                if line.strip().isdigit():
                    continue
            if not line or line.startswith("\t") or line.startswith("#"):
                continue
            word, _, flags = line.partition("/")
            # drop morphological tags after whitespace
            word = word.split()[0] if word.split() else ""
            if not word:
                continue
            # Skip flags that mark non-standalone / forbidden stems
            if "!" in flags or "X" in flags:
                continue
            w = norm(word)
            if LETTERS.match(w):
                lemmas.add(w)
            for form in expand(word, flags, pfx, sfx):
                fw = norm(form)
                if LETTERS.match(fw):
                    forms.add(fw)

    freq_rank = {}
    with open(freq_path, encoding="utf-8") as f:
        for i, line in enumerate(f):
            parts = line.split()
            if not parts:
                continue
            w = norm(parts[0])
            if w not in freq_rank:
                freq_rank[w] = i

    # Words that exist as standalone dictionary lemmas and are frequent.
    ranked = sorted(
        (w for w in lemmas if w in freq_rank and LETTERS.match(w)),
        key=lambda w: freq_rank[w],
    )
    answers = [w for w in ranked if w not in blacklist][:ANSWER_POOL_SIZE]

    os.makedirs(out_dir, exist_ok=True)
    guesses = sorted((forms | lemmas) - set())  # ß-words already filtered by LETTERS
    guesses = sorted(set(guesses) | set(answers))
    with open(os.path.join(out_dir, "guesses.json"), "w", encoding="utf-8") as f:
        json.dump(guesses, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "answers.json"), "w", encoding="utf-8") as f:
        json.dump(sorted(answers), f, ensure_ascii=False, separators=(",", ":"))
    print(f"lemmas(5 letters)={len(lemmas)} all_forms(5 letters)={len(guesses)} answers={len(answers)}")


if __name__ == "__main__":
    main()
