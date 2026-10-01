#!/usr/bin/env python3
"""
Build the two EA files people actually download, from the one master.

    python3 scripts/build-ea-variants.py            # write them
    python3 scripts/build-ea-variants.py --check    # verify only, write nothing

Why generate instead of keeping two files: they would drift. Every fix
would have to be made twice and the second one would eventually be
forgotten, which for the build that sits on the LIVE accounts is not a
risk worth taking for the sake of avoiding one script.

The master is ea/OnlyFunds_Reporter_v1.5.mq5 and it compiles as-is (as
the OnlyFunds Report build). The AI build is the same file with
ONLYFUNDS_AI defined at the top, so the trading code is compiled in.

MetaEditor is the only thing that can really compile MQL5, and it is not
available here, so --check runs the preprocessor itself and then makes
sure the OnlyFunds Report build says nothing about anything it no longer
contains: no trade object, no trade call, no command handler.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / 'ea' / 'OnlyFunds_Reporter_v1.5.mq5'
OUT_DIR = ROOT / 'frontend' / 'public' / 'ea'

FLAG = 'ONLYFUNDS_AI'

# The two names have to be told apart at a glance in the MT5 Navigator,
# where they sit next to each other and one of them can trade. "Report
# with AI" and "Report Only" differed by a single word, which is how the
# trading build ends up on a live account by mistake.
VARIANTS = {
    'OnlyFunds_Report_v1.5.mq5': {
        'ai': False,
        'title': 'OnlyFunds Report v1.5',
        'blurb': 'Reports this account to the dashboard. It contains no trading\n'
                 '// code at all: there is no setting to switch on, and nothing the\n'
                 '// server sends can make it place, change or close an order.\n'
                 '// This is the one for accounts where real money is working.',
    },
    'OnlyFunds_AI_v1.5.mq5': {
        'ai': True,
        'title': 'OnlyFunds AI v1.5',
        'blurb': 'Reports this account AND carries out the orders the dashboard\n'
                 '// sends, once you set EnableTrading = true on its chart. Start\n'
                 '// it on a demo account.',
    },
}

# Nothing from the trading half may survive into the OnlyFunds Report build.
FORBIDDEN_IN_REPORT_ONLY = [
    'g_trade', 'CTrade', 'Trade/Trade.mqh',
    'HandleCommands', 'DoOpenTrade', 'DoClosePosition', 'DoSetSlTp',
    'DoCloseAll', 'SendAck', 'PositionClosePartial', 'OrderSend',
]


def banner(name: str, spec: dict) -> str:
    return (
        '//+------------------------------------------------------------------+\n'
        f'//| {spec["title"]:<64} |\n'
        '//|                                                                  |\n'
        '//| GENERATED FILE - do not edit.                                    |\n'
        '//| Source: ea/OnlyFunds_Reporter_v1.5.mq5                           |\n'
        '//| Rebuild: python3 scripts/build-ea-variants.py                    |\n'
        '//+------------------------------------------------------------------+\n'
        f'// {spec["blurb"]}\n'
        '\n'
        + (f'#define {FLAG} 1\n\n' if spec['ai'] else '')
    )


def preprocess(src: str, defined: bool) -> str:
    """Resolve #ifdef ONLYFUNDS_AI / #else / #endif, as the compiler would."""
    out, stack = [], []          # stack of "is this branch being kept"
    for n, line in enumerate(src.split('\n'), 1):
        bare = line.strip()
        if bare.startswith('#ifdef ') or bare.startswith('#ifndef '):
            macro = bare.split(None, 1)[1].strip()
            if macro != FLAG:
                raise SystemExit(f'{MASTER}:{n}: unexpected conditional on {macro!r}; '
                                 f'this script only knows {FLAG}')
            keep = defined if bare.startswith('#ifdef ') else not defined
            stack.append(keep)
            continue
        if bare == '#else':
            if not stack:
                raise SystemExit(f'{MASTER}:{n}: #else with no #ifdef')
            stack[-1] = not stack[-1]
            continue
        if bare.startswith('#endif'):
            if not stack:
                raise SystemExit(f'{MASTER}:{n}: #endif with no #ifdef')
            stack.pop()
            continue
        if all(stack):
            out.append(line)
    if stack:
        raise SystemExit(f'{MASTER}: {len(stack)} #ifdef left unclosed')
    return '\n'.join(out)


def strip_comments_and_strings(src: str) -> str:
    """
    So a word inside a comment or a message is not read as code.

    Scanned rather than done with three regexes, because the three fight
    each other: strip comments first and the // inside
    "https://onlyfunds.duckdns.org" takes the rest of the line with it,
    leaving an unterminated literal that then eats whatever follows;
    strip strings first and a // comment containing a quote does the
    same in reverse. One pass, left to right, is the only way it stays
    right.
    """
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                if src[i] == '\n':
                    out.append('\n')
                i += 1
            i += 2
        elif c in '"\'':
            quote = c
            i += 1
            while i < n and src[i] != quote:
                i += 2 if src[i] == '\\' else 1
            i += 1
            out.append('""')
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def check(master: str) -> list:
    problems = []
    for name, spec in VARIANTS.items():
        body = preprocess(master, spec['ai'])
        code = strip_comments_and_strings(body)

        opens, closes = code.count('{'), code.count('}')
        if opens != closes:
            problems.append(f'{name}: {opens} "{{" but {closes} "}}"')

        # Every function the build calls must be one the build still defines.
        defined = set(re.findall(
            r'^(?:void|bool|string|int|double|datetime|long|ulong)\s+(\w+)\s*\(',
            code, re.M))
        for fn in ('HandleCommands', 'SendAck', 'DoOpenTrade', 'DoClosePosition',
                   'DoSetSlTp', 'DoCloseAll', 'TradingPossible'):
            if re.search(r'\b' + fn + r'\s*\(', code) and fn not in defined:
                problems.append(f'{name}: calls {fn}() which this build does not define')

        if not spec['ai']:
            for word in FORBIDDEN_IN_REPORT_ONLY:
                if re.search(r'\b' + re.escape(word) + r'\b', code):
                    problems.append(f'{name}: still contains {word!r} — '
                                    f'the OnlyFunds Report build must not')
            if 'const bool     EnableTrading' not in body:
                problems.append(f'{name}: EnableTrading is not defined')
            if '"1.4-report"' not in body:
                problems.append(f'{name}: does not report itself as 1.4-report')
        else:
            if 'input bool     EnableTrading' not in body:
                problems.append(f'{name}: EnableTrading is not an input')
            if '"1.4-ai"' not in body:
                problems.append(f'{name}: does not report itself as 1.4-ai')
    return problems


def main() -> int:
    master = MASTER.read_text(encoding='utf-8')
    problems = check(master)
    if problems:
        print('The variants do not come out right:\n')
        for p in problems:
            print('  ✗', p)
        return 1

    if '--check' in sys.argv:
        # Also catch the likelier mistake: editing the master and forgetting
        # to run this without --check, so the files people download are a
        # version behind the source they are supposed to come from.
        stale = []
        for name, spec in VARIANTS.items():
            want = banner(name, spec) + master
            path = OUT_DIR / name
            if not path.exists():
                stale.append(f'{name}: not built yet')
            elif path.read_text(encoding='utf-8') != want:
                stale.append(f'{name}: out of date with the master')
        if stale:
            print('The published files do not match the master:\n')
            for t in stale:
                print('  ✗', t)
            print('\nRun:  python3 scripts/build-ea-variants.py')
            return 1
        print('✓ both variants check out, and the published files match')
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, spec in VARIANTS.items():
        (OUT_DIR / name).write_text(banner(name, spec) + master, encoding='utf-8')
        kept = len(preprocess(master, spec['ai']).split('\n'))
        print(f'✓ {name}  ({kept} lines after the preprocessor)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
