# Zeichnet die PNG-Icons nach public/icon.svg nach.
# Auf dem Rechner gibt es keinen SVG-Renderer, deshalb wird das Motiv hier mit System.Drawing
# noch einmal von Hand gezeichnet. Bei Logoaenderungen muessen icon.svg UND dieses Skript angepasst werden.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out  = Join-Path $root "public"

function Hex($h) { [System.Drawing.ColorTranslator]::FromHtml($h) }

function New-Icon {
    param(
        [int]$Size,
        [string]$Datei,
        [double]$Motiv,     # Anteil des Motivs an der Kante (1 = wie in der SVG)
        [double]$Ecken      # Eckenradius relativ zur Kante (0 = eckig, volle Flaeche)
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Hintergrund
    $bg = New-Object System.Drawing.SolidBrush((Hex "#12263b"))
    if ($Ecken -gt 0) {
        $r = [int]($Size * $Ecken)
        $p = New-Object System.Drawing.Drawing2D.GraphicsPath
        $p.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
        $p.AddArc($Size-2*$r, 0, 2*$r, 2*$r, 270, 90)
        $p.AddArc($Size-2*$r, $Size-2*$r, 2*$r, 2*$r, 0, 90)
        $p.AddArc(0, $Size-2*$r, 2*$r, 2*$r, 90, 90)
        $p.CloseFigure()
        $g.FillPath($bg, $p)
    } else {
        $g.FillRectangle($bg, 0, 0, $Size, $Size)
    }

    # SVG-Koordinaten (512er Raster) -> Pixel, Motiv um die Mitte skaliert
    $k = $Size / 512.0 * $Motiv
    $mid = $Size / 2.0
    $X = { param($v) [single]($mid + ($v - 256) * $k) }
    $L = { param($v) [single]($v * $k) }

    # Foto
    $fx = & $X 130; $fy = & $X 64
    $fw = & $L 252; $fh = & $L 324
    $foto = New-Object System.Drawing.RectangleF($fx, $fy, $fw, $fh)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush((Hex "#e9edf1"))), $foto)

    # Kopf und Schultern, auf das Foto begrenzt
    $g.SetClip($foto)
    $grau = New-Object System.Drawing.SolidBrush((Hex "#6b7a8c"))
    $g.FillEllipse($grau, (& $X 196), (& $X 126), (& $L 120), (& $L 120))
    $g.FillEllipse($grau, (& $X 152), (& $X 300), (& $L 208), (& $L 184))
    $g.ResetClip()

    # Eckmarken
    $stift = New-Object System.Drawing.Pen((Hex "#5eead4"), (& $L 16))
    $stift.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $stift.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $stift.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $marken = @(
        @(104,118,104,80,120,64,158,64),
        @(408,118,408,80,392,64,354,64),
        @(104,334,104,372,120,388,158,388),
        @(408,334,408,372,392,388,354,388)
    )
    foreach ($e in $marken) {
        $pts = [System.Drawing.PointF[]]@(
            (New-Object System.Drawing.PointF((& $X ($e[0])), (& $X ($e[1])))),
            (New-Object System.Drawing.PointF((& $X ($e[2])), (& $X ($e[3])))),
            (New-Object System.Drawing.PointF((& $X ($e[4])), (& $X ($e[5])))),
            (New-Object System.Drawing.PointF((& $X ($e[6])), (& $X ($e[7]))))
        )
        $g.DrawLines($stift, $pts)
    }

    # Haken-Plakette
    $g.FillEllipse((New-Object System.Drawing.SolidBrush((Hex "#5eead4"))), (& $X 310), (& $X 342), (& $L 124), (& $L 124))
    $haken = New-Object System.Drawing.Pen((Hex "#06231f"), (& $L 18))
    $haken.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $haken.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $haken.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawLines($haken, [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF((& $X 342), (& $X 404))),
        (New-Object System.Drawing.PointF((& $X 364), (& $X 426))),
        (New-Object System.Drawing.PointF((& $X 404), (& $X 382)))
    ))

    $g.Dispose()
    $bmp.Save((Join-Path $out $Datei), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "$Datei ($Size px)"
}

New-Icon -Size 192 -Datei "icon-192.png" -Motiv 1.0 -Ecken 0.2
New-Icon -Size 512 -Datei "icon-512.png" -Motiv 1.0 -Ecken 0.2
# maskable: volle Flaeche, Motiv innerhalb der Sicherheitszone (Kreis mit 40 % Radius)
New-Icon -Size 512 -Datei "icon-maskable-512.png" -Motiv 0.72 -Ecken 0
# iOS legt seine eigene Maske darueber: eckig, Motiv fast randvoll
New-Icon -Size 180 -Datei "apple-touch-icon.png" -Motiv 0.9 -Ecken 0
