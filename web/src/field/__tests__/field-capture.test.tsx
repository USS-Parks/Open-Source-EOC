// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importXlsForm, type AnswerRecord } from "@openeoc/shared";
import { FieldCaptureFields, mediaAttachments } from "../FieldCapture.js";

// The COP map needs WebGL; a stand-in reports taps at successive positions.
const taps = vi.hoisted(() => ({ next: 0 }));
vi.mock("../../cop/CopMap.js", () => ({
  CopMap: (props: { picking?: boolean; onPickPoint?: (point: [number, number]) => void }) => (
    <button type="button" disabled={!props.picking} onClick={() => {
      const points: Array<[number, number]> = [[-124.16, 40.8], [-124.17, 40.8], [-124.18, 40.82]];
      props.onPickPoint?.(points[taps.next++ % points.length]!);
    }}>Tap the map</button>
  ),
}));

const definition = importXlsForm({
  survey: [
    { type: "select_one counties", name: "county", label: "County", required: "yes" },
    { type: "select_one towns", name: "town", label: "Town", choice_filter: "county=${county}" },
    { type: "geotrace", name: "route", label: "Road segment" },
    { type: "geoshape", name: "area", label: "Affected area" },
    { type: "barcode", name: "asset_tag", label: "Asset tag" },
    { type: "image", name: "photo", label: "Photo" },
    { type: "audio", name: "voice_note", label: "Voice note" },
    { type: "begin_repeat", name: "crews", label: "Crew" },
    { type: "text", name: "crew_name", label: "Crew name", required: "yes" },
    { type: "image", name: "crew_photo", label: "Crew photo" },
    { type: "end_repeat", name: "crews" },
  ],
  choices: [
    { list_name: "counties", name: "humboldt", label: "Humboldt" },
    { list_name: "counties", name: "del_norte", label: "Del Norte" },
    { list_name: "towns", name: "eureka", label: "Eureka", county: "humboldt" },
    { list_name: "towns", name: "arcata", label: "Arcata", county: "humboldt" },
    { list_name: "towns", name: "klamath", label: "Klamath", county: "del_norte" },
  ],
}, { key: "field_survey" });

let latest: { answers: AnswerRecord; media: ReadonlyMap<string, File> } = { answers: {}, media: new Map() };

function Harness() {
  const [answers, setAnswers] = useState<AnswerRecord>({});
  const [media, setMedia] = useState<ReadonlyMap<string, File>>(new Map());
  latest = { answers, media };
  return <form aria-label="Survey"><FieldCaptureFields definition={definition} answers={answers} media={media}
    onMedia={(token, file) => setMedia((current) => new Map(current).set(token, file))} onChange={setAnswers} /></form>;
}

afterEach(() => {
  cleanup();
  taps.next = 0;
});

describe("the smart form runner", () => {
  it("shows a signature question as a pad to sign, not a file to choose", () => {
    const receipt = importXlsForm({
      survey: [{ type: "image", name: "receiver", label: "Received by", appearance: "signature" }],
      choices: [],
    }, { key: "delivery_receipt" });
    render(<form aria-label="Receipt"><FieldCaptureFields definition={receipt} answers={{}} media={new Map()}
      onMedia={() => undefined} onChange={() => undefined} /></form>);
    const signature = screen.getByRole("group", { name: "Received by" });
    expect(within(signature).getByLabelText("Signed by")).toBeTruthy();
    expect(within(signature).getByRole("button", { name: "Sign" })).toBeTruthy();
    expect(signature.querySelector('input[type="file"]')).toBeNull();
  });

  it("draws a line and a closed polygon from map taps, with undo and typed coordinates", async () => {
    render(<Harness />);
    const line = screen.getByRole("group", { name: "Road segment" });
    fireEvent.click(within(line).getByRole("button", { name: "Draw on map" }));
    fireEvent.click(within(line).getByRole("button", { name: "Tap the map" }));
    fireEvent.click(within(line).getByRole("button", { name: "Tap the map" }));
    fireEvent.click(within(line).getByRole("button", { name: "Tap the map" }));
    fireEvent.click(within(line).getByRole("button", { name: "Undo point" }));
    expect(within(line).getByText(/^2 points placed\./)).toBeTruthy();
    expect(latest.answers.route).toBe("40.8 -124.16;40.8 -124.17");

    const area = screen.getByRole("group", { name: "Affected area" });
    const closeButton = within(area).getByRole("button", { name: "Close polygon" }) as HTMLButtonElement;
    fireEvent.change(within(area).getByLabelText(/^Boundary points/), {
      target: { value: "40.80 -124.16;40.81 -124.16;40.81 -124.17" },
    });
    expect(within(area).getByRole("alert").textContent).toBe("a polygon must be closed: repeat the first point last");
    expect(closeButton.disabled).toBe(false);
    fireEvent.click(closeButton);
    expect(latest.answers.area).toBe("40.8 -124.16;40.81 -124.16;40.81 -124.17;40.8 -124.16");
    expect(within(area).getByText(/4 points placed, polygon closed/)).toBeTruthy();
    expect(within(area).queryByRole("alert")).toBeNull();
  });

  it("offers only the towns of the chosen county and flags one the county no longer allows", () => {
    render(<Harness />);
    const town = screen.getByLabelText("Town") as HTMLSelectElement;
    expect([...town.options].map((option) => option.value)).toEqual([""]);
    fireEvent.change(screen.getByLabelText(/^County/), { target: { value: "humboldt" } });
    expect([...town.options].map((option) => option.value)).toEqual(["", "eureka", "arcata"]);
    fireEvent.change(town, { target: { value: "arcata" } });
    fireEvent.change(screen.getByLabelText(/^County/), { target: { value: "del_norte" } });
    expect([...town.options].map((option) => option.value)).toEqual(["", "klamath"]);
    expect(town.value).toBe("");
    expect(screen.getByText("not an allowed choice")).toBeTruthy();
  });

  it("adds and removes repeat entries and nests their answers", () => {
    render(<Harness />);
    const crews = screen.getByRole("group", { name: "Crew" });
    fireEvent.click(within(crews).getByRole("button", { name: "Add Crew" }));
    fireEvent.click(within(crews).getByRole("button", { name: "Add Crew" }));
    fireEvent.change(within(screen.getByRole("region", { name: "Crew 1" })).getByLabelText(/^Crew name/), { target: { value: "Engine 12" } });
    fireEvent.change(within(screen.getByRole("region", { name: "Crew 2" })).getByLabelText(/^Crew name/), { target: { value: "Dozer 3" } });
    expect(latest.answers.crews).toEqual([{ crew_name: "Engine 12" }, { crew_name: "Dozer 3" }]);
    fireEvent.click(within(crews).getByRole("button", { name: "Remove Crew 1" }));
    expect(latest.answers.crews).toEqual([{ crew_name: "Dozer 3" }]);
    expect(screen.queryByRole("region", { name: "Crew 2" })).toBeNull();
  });

  it("reads a barcode from a camera image and takes one typed when the browser cannot", async () => {
    const detector = Object.getOwnPropertyDescriptor(globalThis, "BarcodeDetector");
    const bitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    try {
      Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: vi.fn().mockResolvedValue({ close: vi.fn() }) });
      Object.defineProperty(globalThis, "BarcodeDetector", { configurable: true, value: class {
        async detect() { return [{ rawValue: " CUL-0042 " }]; }
      } });
      render(<Harness />);
      fireEvent.change(screen.getByLabelText("Scan Asset tag"), { target: { files: [new File(["code"], "tag.png", { type: "image/png" })] } });
      await waitFor(() => expect(latest.answers.asset_tag).toBe("CUL-0042"));

      delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
      fireEvent.change(screen.getByLabelText("Scan Asset tag"), { target: { files: [new File(["code"], "tag.png", { type: "image/png" })] } });
      expect(await screen.findByText("This browser could not read the code. Enter it manually.")).toBeTruthy();
      fireEvent.change(screen.getByLabelText("Asset tag"), { target: { value: "CUL-0043" } });
      expect(latest.answers.asset_tag).toBe("CUL-0043");
    } finally {
      if (detector) Object.defineProperty(globalThis, "BarcodeDetector", detector);
      else delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
      if (bitmap) Object.defineProperty(globalThis, "createImageBitmap", bitmap);
      else delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    }
  });

  it("holds photo and audio files with the draft and lists them by question for the queue", async () => {
    const { container } = render(<Harness />);
    const photo = new File(["png"], "culvert.png", { type: "image/png" });
    const voice = new File(["wav"], "voice-note.wav", { type: "audio/wav" });
    const audioInput = screen.getByLabelText("Voice note") as HTMLInputElement;
    expect(audioInput.accept).toBe("audio/*");
    fireEvent.change(audioInput, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(screen.getByText("Choose an MP3, M4A, AAC, Ogg, WebM or WAV recording.")).toBeTruthy();
    fireEvent.change(audioInput, { target: { files: [voice] } });
    fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [photo] } });
    fireEvent.click(within(screen.getByRole("group", { name: "Crew" })).getByRole("button", { name: "Add Crew" }));
    const crewPhoto = new File(["png"], "crew.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Crew photo"), { target: { files: [crewPhoto] } });
    expect(screen.getByText("Attached: culvert.png. It uploads after the report synchronizes.")).toBeTruthy();

    const captured = mediaAttachments(definition, latest.answers, latest.media);
    expect(captured.files).toEqual([
      { question: "photo", file: photo },
      { question: "voice_note", file: voice },
      { question: "crews[0].crew_photo", file: crewPhoto },
    ]);
    expect(captured.answers).toMatchObject({ photo: "culvert.png", voice_note: "voice-note.wav", crews: [{ crew_photo: "crew.png" }] });
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
