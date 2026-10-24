// OKLCH to sRGB and WCAG contrast, enough to verify the design tokens. Taken from schmidbauer.dev.
// Matrices: CSS Color 4 / Björn Ottosson (Oklab).

export interface Oklch {
	l: number; // 0..1
	c: number;
	h: number; // degrees
}

export interface Rgb {
	r: number; // 0..255
	g: number;
	b: number;
}

/** Parses `oklch(93.6% 0.014 97)` into { l: 0.936, c: 0.014, h: 97 }. */
export function parseOklch(input: string): Oklch {
	const match = input.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/i);
	if (!match) throw new Error(`Invalid oklch string: ${input}`);
	return { l: Number(match[1]) / 100, c: Number(match[2]), h: Number(match[3]) };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Linear sRGB channel to gamma-encoded sRGB (0..1). */
function linearToSrgb(x: number): number {
	const c = clamp01(x);
	return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Gamma-encoded sRGB channel (0..1) to linear. */
function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function oklchToSrgb({ l: L, c, h }: Oklch): Rgb {
	const hr = (h * Math.PI) / 180;
	const a = c * Math.cos(hr);
	const b = c * Math.sin(hr);

	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;

	const l3 = l_ ** 3;
	const m3 = m_ ** 3;
	const s3 = s_ ** 3;

	const rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
	const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
	const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

	return {
		r: Math.round(linearToSrgb(rLin) * 255),
		g: Math.round(linearToSrgb(gLin) * 255),
		b: Math.round(linearToSrgb(bLin) * 255)
	};
}

/** Relative luminance (WCAG 2.1) of 0..255 sRGB. */
export function relativeLuminance({ r, g, b }: Rgb): number {
	const R = srgbToLinear(r / 255);
	const G = srgbToLinear(g / 255);
	const B = srgbToLinear(b / 255);
	return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio (at least 1), in either order. */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}
