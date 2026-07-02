import type { ReactNode } from 'react';
import translations from './translations';

type TranslatedRichTextProps = {
    i18nKey: string;
    values: Record<string, string | number>;
};

const richTagPattern = /<(time|cache|accuracy)>(.*?)<\/\1>/g;

function renderRichText(text: string): ReactNode[] {
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    richTagPattern.lastIndex = 0;

    while ((match = richTagPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        parts.push(<strong key={`${match[1]}-${match.index}`}>{match[2]}</strong>);
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts;
}

export default function TranslatedRichText({ i18nKey, values }: TranslatedRichTextProps) {
    const { t } = translations.useTranslation();
    return <>{renderRichText(t(i18nKey, values))}</>;
}
