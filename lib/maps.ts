"use client";

// Integración con Google Maps. Sin NEXT_PUBLIC_GOOGLE_MAPS_API_KEY la app sigue funcionando:
// el lugar se escribe a mano y se ofrece un enlace para abrirlo en Google Maps.
export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export function mapsLink(place: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}

export function mapsEmbed(place: string): string | null {
  if (!MAPS_KEY) return null;
  return `https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&language=es&q=${encodeURIComponent(place)}`;
}

let loading: Promise<boolean> | null = null;

/** Carga el script de Google Maps una sola vez. Devuelve false si no hay clave o falla. */
function loadMaps(): Promise<boolean> {
  if (!MAPS_KEY || typeof window === "undefined") return Promise.resolve(false);
  if (!loading) {
    loading = new Promise((resolve) => {
      const cb = "__cavMapsReady";
      (window as unknown as Record<string, () => void>)[cb] = () => resolve(true);
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&loading=async&language=es&region=CO&callback=${cb}`;
      s.async = true;
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return loading;
}

async function lib<T>(name: string): Promise<T | null> {
  if (!(await loadMaps())) return null;
  try {
    return (await google.maps.importLibrary(name)) as T;
  } catch {
    return null;
  }
}

export const loadPlaces = () => lib<google.maps.PlacesLibrary>("places");
export const loadMapsLib = () => lib<google.maps.MapsLibrary>("maps");
export const loadGeocoding = () => lib<google.maps.GeocodingLibrary>("geocoding");

/** "Nombre, dirección" sin repetir el nombre si la dirección ya empieza por él. */
export function placeLabel(name: string | null | undefined, address: string | null | undefined): string {
  const n = (name ?? "").trim();
  const a = (address ?? "").trim();
  if (!a) return n;
  return !n || a.startsWith(n) ? a : `${n}, ${a}`;
}

export type PlaceSuggestion = { text: string; secondary: string; pick: () => Promise<string> };

/** Sugerencias de Google para lo escrito; al elegir una, devuelve "Nombre, dirección". */
export async function suggestPlaces(
  input: string,
  session: google.maps.places.AutocompleteSessionToken | null,
): Promise<PlaceSuggestion[]> {
  const lib = await loadPlaces();
  if (!lib || input.trim().length < 3) return [];
  try {
    const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
      language: "es",
      region: "co",
      includedRegionCodes: ["co"],
      sessionToken: session ?? undefined,
    });
    return suggestions.flatMap((s) => {
      const p = s.placePrediction;
      if (!p) return [];
      return [{
        text: p.mainText?.text ?? p.text.text,
        secondary: p.secondaryText?.text ?? "",
        pick: async () => {
          const place = p.toPlace();
          await place.fetchFields({ fields: ["displayName", "formattedAddress"] });
          return placeLabel(place.displayName ?? p.mainText?.text, place.formattedAddress) || p.text.text;
        },
      }];
    });
  } catch {
    return [];
  }
}

export async function newSession(): Promise<google.maps.places.AutocompleteSessionToken | null> {
  const lib = await loadPlaces();
  return lib ? new lib.AutocompleteSessionToken() : null;
}
