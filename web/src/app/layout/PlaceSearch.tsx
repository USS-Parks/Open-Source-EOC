import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { ApiClient, PlaceResult, PlaceSearch as PlaceSearchResponse } from "../api/client.js";
import { jurisdictionMapBounds } from "../config.js";

const KIND_LABEL: Readonly<Record<PlaceResult["kind"], string>> = {
  address: "Address",
  street: "Street",
  place: "Place",
  poi: "Point of interest",
};

/**
 * The map's address and place search over the server's offline
 * gazetteer. Typing searches; arrow keys move through the results, Enter
 * or a click chooses one, Escape closes the list and then clears the box.
 */
export function PlaceSearch(props: {
  readonly client: Pick<ApiClient, "searchPlaces">;
  readonly onChoose: (place: PlaceResult) => void;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ query: string; response: PlaceSearchResponse } | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const query = text.trim();

  useEffect(() => {
    if (query.length < 2 || found?.query === query) return;
    let live = true;
    // Equally good matches are ordered nearest the jurisdiction's map extent first.
    const [west, south, east, north] = jurisdictionMapBounds();
    const timer = setTimeout(() => {
      props.client.searchPlaces(query, [(west + east) / 2, (south + north) / 2]).then(
        (response) => {
          if (!live) return;
          setFound({ query, response });
          setFailed(false);
          setActive(0);
        },
        () => {
          if (live) setFailed(true);
        },
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const current = query.length >= 2 && found?.query === query ? found.response : null;
  const results = current?.results ?? [];
  const status = query.length < 2
    ? null
    : failed
      ? "Search failed. Try again."
      : !current
        ? "Searching…"
        : !current.available
          ? "Offline address search is unavailable on this server."
          : results.length === 0
            ? "No matching address or place."
            : null;
  const expanded = open && results.length > 0;

  function choose(place: PlaceResult) {
    setText(place.label);
    setFound({ query: place.label.trim(), response: { available: true, results: [place] } });
    setOpen(false);
    props.onChoose(place);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (results.length) {
        setActive((index) => event.key === "ArrowDown"
          ? Math.min(index + 1, results.length - 1)
          : Math.max(index - 1, 0));
      }
    } else if (event.key === "Enter" && expanded && results[active]) {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (open) setOpen(false);
      else setText("");
    }
  }

  return (
    <div
      className="eoc-shell-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        type="search"
        role="combobox"
        aria-label="Search addresses and places"
        placeholder="Search location…"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <div className="eoc-shell-search-popup" hidden={!open || (!status && results.length === 0)}>
        <p role="status">{open ? status : null}</p>
        <ul id={listId} role="listbox" aria-label="Addresses and places">
          {results.map((place, index) => (
            <li
              key={`${place.kind}:${place.label}:${place.lon},${place.lat}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(place)}
            >
              <strong>{place.label}</strong>
              <span>{[KIND_LABEL[place.kind], place.detail].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
