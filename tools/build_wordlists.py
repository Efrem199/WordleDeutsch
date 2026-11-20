#!/usr/bin/env python3
"""
Builds 5-letter German NOUN word lists for the Wordle/Quordle site.

Sources (see README "Источники данных"):
  * dictionary-de (npm, Hunspell de_DE / igerman98, GPLv2/GPLv3):
    in the German Hunspell dictionary nouns are written with a capital initial
    (e.g. "Wurst/ijm"), while adjectives and verbs are lowercase ("wurst/hke").
    Only capitalised lemmas are used, so the lists contain nouns only.
  * FrequencyWords (hermitdave, MIT, OpenSubtitles 2016 de):
    used to rank nouns so that the most common ones become answers.

Output:
  guesses.json  – all valid guesses: 5-letter noun lemmas (nominative singular)
  answers.json  – the most frequent noun lemmas (minus tools/answer_blacklist.txt)

Usage:
  python3 tools/build_wordlists.py <path-to-dic> <path-to-freq> <out-dir>
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


def read_noun_lemmas(dic_path):
    """Леммы-существительные: в Hunspell de_DE они пишутся с заглавной буквы."""
    nouns = set()
    with open(dic_path, encoding="utf-8", errors="replace") as f:
        first = True
        for line in f:
            line = line.rstrip("\n")
            if first:
                first = False
                if line.strip().isdigit():
                    continue  # строка с количеством записей
            if not line or line.startswith("\t") or line.startswith("#"):
                continue
            word, _, flags = line.partition("/")
            parts = word.split()
            if not parts:
                continue
            word = parts[0]
            # стоп-флаги: нестандартные и запрещённые основы
            if "!" in flags or "X" in flags:
                continue
            if not word[0].isupper():
                continue  # прилагательные, глаголы, наречия — строчные
            w = norm(word)
            if LETTERS.match(w):
                nouns.add(w)
    return nouns


def read_frequency_rank(freq_path):
    rank = {}
    with open(freq_path, encoding="utf-8") as f:
        for i, line in enumerate(f):
            parts = line.split()
            if not parts:
                continue
            w = norm(parts[0])
            if w not in rank:
                rank[w] = i
    return rank


def main():
    dic_path, freq_path, out_dir = sys.argv[1:4]
    bl_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "answer_blacklist.txt")
    blacklist = set()
    with open(bl_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                blacklist.add(norm(line))

    nouns = read_noun_lemmas(dic_path)
    rank = read_frequency_rank(freq_path)

    ranked = sorted((w for w in nouns if w in rank), key=lambda w: rank[w])
    answers = [w for w in ranked if w not in blacklist][:ANSWER_POOL_SIZE]
    guesses = sorted(nouns | set(answers))

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "guesses.json"), "w", encoding="utf-8") as f:
        json.dump(guesses, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "answers.json"), "w", encoding="utf-8") as f:
        json.dump(sorted(answers), f, ensure_ascii=False, separators=(",", ":"))
    print(f"nouns(5 letters)={len(nouns)} guesses={len(guesses)} answers={len(answers)}")


if __name__ == "__main__":
    main()
