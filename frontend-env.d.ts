declare module '*.css';
declare module '*.svg' {
    const url: string;
    export default url;
}

declare module '*.png' {
    const url: string;
    export default url;
}

declare module '*.jpg' {
    const url: string;
    export default url;
}

declare module '*.jpeg' {
    const url: string;
    export default url;
}

declare module '*.webp' {
    const url: string;
    export default url;
}

interface ImportMeta {
    glob<T = unknown>(
        pattern: string | string[],
        options?: {
            eager?: boolean;
            query?: string | Record<string, string | boolean | number>;
            import?: string;
        },
    ): Record<string, T>;
}
