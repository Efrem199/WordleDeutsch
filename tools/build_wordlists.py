#!/usr/bin/env python3
"""
Builds 5-letter German word lists for the Wordle/Quordle site.

Sources (see README "Источники данных"):
  * dictionary-de (npm, Hunspell de_DE / igerman98, GPLv2/GPLv3):
    base words + affix rules -> all inflected forms (valid guesses).
    In the German Hunspell dictionary nouns are written with a capital initial
    ("Wurst/ijm"), adjectives and verbs are lowercase ("wurst/hke").
  * FrequencyWords (hermitdave, MIT, OpenSubtitles 2016 de):
    used to rank nouns so that the most common ones become answers.

Output:
  guesses.json  – every valid 5-letter form from the dictionary (nouns, verbs, adjectives, ...)
  answers.json  – the most frequent NOUN lemmas (capitalised in the dictionary), minus
                  tools/answer_blacklist.txt. Only these words can be the solution.

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

ANSWER_POOL_SIZE = 950  # сколько существительных берём в загадки


def norm(w):
    return unicodedata.normalize("NFC", w).lower()


def parse_aff(path):
    """PFX/SFX rules: TYPE FLAG STRIP ADD [CONDITION]. Header lines (4th field numeric) are skipped."""
    pfx, sfx = {}, {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 4 or parts[0] not in ("PFX", "SFX"):
                continue
            if len(parts) == 4 and parts[3].isdigit():
                continue
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
        return re.search("^" + cond, word) is not None
    return re.search(cond + "$", word) is not None


def expand(stem, flags, pfx, sfx):
    out = {stem}
    for fl in flags:
        for strip, add, cond in sfx.get(fl, []):
            if not cond_match(stem, cond, False):
                continue
            base = stem[: len(stem) - len(strip)] if strip else stem
            out.add(base + add)
    for fl in flags:
        for strip, add, cond in pfx.get(fl, []):
            if not cond_match(stem, cond, True):
                continue
            base = stem[len(strip):] if strip else stem
            out.add(add + base)
    return out


def read_dictionary(dic_path, pfx, sfx):
    """Returns (all_forms, noun_lemmas). Noun lemmas = dictionary entries with a capital initial."""
    forms, nouns = set(), set()
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
            parts = word.split()
            if not parts:
                continue
            word = parts[0]
            if "!" in flags or "X" in flags:
                continue
            if word[0].isupper():
                w = norm(word)
                if LETTERS.match(w):
                    nouns.add(w)
            for form in expand(word, flags, pfx, sfx):
                fw = norm(form)
                if LETTERS.match(fw):
                    forms.add(fw)
    return forms, nouns


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
    forms, nouns = read_dictionary(dic_path, pfx, sfx)

    rank = {}
    with open(freq_path, encoding="utf-8") as f:
        for i, line in enumerate(f):
            parts = line.split()
            if parts:
                w = norm(parts[0])
                if w not in rank:
                    rank[w] = i

    ranked = sorted((w for w in nouns if w in rank), key=lambda w: rank[w])
    answers = [w for w in ranked if w not in blacklist][:ANSWER_POOL_SIZE]
    guesses = sorted(forms | nouns)

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "guesses.json"), "w", encoding="utf-8") as f:
        json.dump(guesses, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "answers.json"), "w", encoding="utf-8") as f:
        json.dump(sorted(answers), f, ensure_ascii=False, separators=(",", ":"))
    print(f"guesses={len(guesses)} noun_lemmas={len(nouns)} answers={len(answers)}")


if __name__ == "__main__":
    main()
