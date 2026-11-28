import { useLayoutEffect, useRef, useState } from 'react';

type SideTabPhase = 'hidden' | 'opening' | 'open' | 'closing';
type SideTabTransitionReason = {
    type: 'open' | 'close' | 'switch';
    from: string | null;
    to: string | null;
    expiresAt: number;
};

const SIDETAB_TRANSITION_STORAGE_KEY = 'sidetab:transition';

function readSideTabTransitionReason() {
    try {
        const raw = window.sessionStorage.getItem(SIDETAB_TRANSITION_STORAGE_KEY);
        if (!raw) return null;

        const reason = JSON.parse(raw) as Partial<SideTabTransitionReason>;
        if (
            (reason.type === 'open' || reason.type === 'close' || reason.type === 'switch') &&
            typeof reason.expiresAt === 'number' &&
            reason.expiresAt >= Date.now()
        ) {
            return reason as SideTabTransitionReason;
        }
    } catch {

    }

    return null;
}

export function useSideTabTransition(tabId: string, visible: boolean, disabled = false) {
    const [phase, setPhase] = useState<SideTabPhase>(() => (
        disabled || visible ? 'open' : 'hidden'
    ));
    const [snapping, setSnapping] = useState(false);
    const previousVisibleRef = useRef(visible);

    useLayoutEffect(() => {
        const previousVisible = previousVisibleRef.current;
        previousVisibleRef.current = visible;

        if (disabled) {
            setPhase('open');
            setSnapping(false);
            return;
        }

        const transitionReason = readSideTabTransitionReason();
        if (
            transitionReason?.type === 'switch' &&
            ((visible && transitionReason.to === tabId) || (!visible && transitionReason.from === tabId))
        ) {
            setSnapping(true);
            setPhase(visible ? 'open' : 'hidden');
            let secondFrame = 0;
            const firstFrame = requestAnimationFrame(() => {
                secondFrame = requestAnimationFrame(() => setSnapping(false));
            });
            return () => {
                cancelAnimationFrame(firstFrame);
                if (secondFrame) cancelAnimationFrame(secondFrame);
            };
        }

        setSnapping(false);
        if (visible) {
            setPhase(previousVisible ? 'open' : 'opening');
            const frame = requestAnimationFrame(() => setPhase('open'));
            return () => cancelAnimationFrame(frame);
        }

        setPhase(previousVisible ? 'closing' : 'hidden');
        if (!previousVisible) return;

        const timer = window.setTimeout(() => setPhase('hidden'), 240);
        return () => window.clearTimeout(timer);
    }, [disabled, tabId, visible]);

    return {
        hidden: phase === 'closing' || phase === 'hidden',
        collapsed: phase === 'hidden',
        closing: phase === 'closing',
        switching: snapping,
    };
}
