/** Minúsculas y sin tildes, para buscar sin importar acentos. */
export function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
