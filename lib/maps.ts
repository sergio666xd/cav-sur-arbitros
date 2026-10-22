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

let loading: Promise<google.maps.PlacesLibrary | null> | null = null;

/** Carga la librería Places (API nueva) una sola vez. Devuelve null si no hay clave o falla. */
export function loadPlaces(): Promise<google.maps.PlacesLibrary | null> {
  if (!MAPS_KEY || typeof window === "undefined") return Promise.resolve(null);
  if (!loading) {
    loading = new Promise((resolve) => {
      const cb = "__cavMapsReady";
      (window as unknown as Record<string, () => void>)[cb] = () => {
        google.maps.importLibrary("places").then((lib) => resolve(lib as google.maps.PlacesLibrary), () => resolve(null));
      };
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&loading=async&language=es&region=CO&callback=${cb}`;
      s.async = true;
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return loading;
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
          const name = place.displayName ?? p.mainText?.text ?? "";
          const addr = place.formattedAddress ?? "";
          if (!addr) return name || p.text.text;
          return !name || addr.startsWith(name) ? addr : `${name}, ${addr}`;
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
