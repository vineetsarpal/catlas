import { matrixCell } from "../domain/assessment";
import type {
  AreaAssessment,
  Assessment,
  ContractInput,
} from "../domain/types";
import { usd } from "../format";
export function AreaExplanation({
  area,
  assessment,
  contract,
}: {
  area: AreaAssessment;
  assessment: Assessment;
  contract: ContractInput;
}) {
  return (
    <section
      className="area-explanation"
      aria-label={`${area.name} contribution explanation`}
    >
      <div className="area-title">
        <h3>{area.name} area</h3>
        <span>{area.distanceKm.toFixed(3)} km</span>
      </div>
      <p>
        Fixed reference → earthquake epicentre
        <br />
        Spherical surface distance · Earth radius 6,371 km
      </p>
      <table>
        <caption>
          Magnitude × exclusive distance band
          {contract.minimumMagnitude
            ? ` · minimum M${contract.minimumMagnitude}`
            : ""}
        </caption>
        <thead>
          <tr>
            <th>Raw mw</th>
            <th>≤25 km</th>
            <th>&gt;25–100 km</th>
          </tr>
        </thead>
        <tbody>
          {[0, 6.5, 7, 7.5]
            .map((m) => [
              matrixCell(m, 25, contract.minimumMagnitude).magnitudeRow,
              matrixCell(m, 25, contract.minimumMagnitude).rate * 100,
              matrixCell(m, 100, contract.minimumMagnitude).rate * 100,
            ])
            .map(([row, inner, outer]) => (
              <tr key={row}>
                <th>{row}</th>
                <td
                  className={
                    area.magnitudeRow === row && area.band === "inner"
                      ? "selected-cell"
                      : ""
                  }
                >
                  {inner}%
                </td>
                <td
                  className={
                    area.magnitudeRow === row && area.band === "outer"
                      ? "selected-cell"
                      : ""
                  }
                >
                  {outer}%
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="formula">
        {assessment.status === "Outside coverage" ? (
          <>
            Coverage gate failed · matrix rate not applied →{" "}
            <strong>{usd(area.contribution)}</strong>
          </>
        ) : (
          <>
            {area.rate * 100}% × {usd(area.allocation)} ={" "}
            <strong>{usd(area.contribution)}</strong>
          </>
        )}
      </p>
      <p>
        Allocation is a contractual maximum contribution. Each scheduled area
        contributes once; nested band rates are exclusive.
      </p>
    </section>
  );
}
