MACGYVER DAY — TWO-ESP32 OLED + MOTOR PACKAGE

WHAT IT DOES
- OLED ESP32 plays the 150-frame MacGyver animation on the SSD1306.
- After drawing frame 0, it raises a start wire.
- Motor ESP32 waits for that signal, then starts both song parts together.
- The OLED board handles all display transfers; the motor timing loop remains on the other board.

FILES
OLEDIntro/OLEDIntro.ino      Upload to the ESP32 connected to the OLED.
OLEDIntro/MacGyver.h         The 150 128x64 animation frames; keep beside the .ino.
MotorController/MotorController.ino  Upload to the ESP32 connected to both A4988 drivers.

WIRING BETWEEN THE ESP32 BOARDS
OLED board pin 15  -> Motor board pin 25 (start signal, 3.3 V logic)
OLED board GND     -> Motor board GND (common ground)

OLED wiring on the OLED ESP32
3V3 -> OLED VCC
GND -> OLED GND
21  -> OLED SDA
22  -> OLED SCL

Motor board connections remain as in the supplied song sketch:
16 -> Motor 1 A4988 STEP; 17 -> Motor 1 A4988 DIR
19 -> Motor 2 A4988 STEP; 18 -> Motor 2 A4988 DIR

POWER-UP
Power both ESP32 boards from the same switched supply so both boot together.
Keep the two board grounds connected. Do not connect two separate 5 V outputs
with their positive rails tied together; either use one suitable regulated 5 V
source branched to both VIN/5V inputs, or power each board from its own USB
output while connecting the grounds and start signal. Keep the A4988 motor
supply wiring as already configured.

FRAME RATE
The header contains 150 frames but does not contain the source frame-rate
metadata. OLEDIntro.ino is set to 100 ms/frame (10 fps), so 150 frames take
about 15 seconds. Change FRAME_INTERVAL_MS to match the frame sampling rate
used when making the header: 100 ms = 10 fps; 67 ms = about 15 fps; 40 ms =
25 fps (if the OLED can sustain the transfer rate). The two boards synchronize
at the first displayed frame, independent of the full animation duration.

ARDUINO IDE
1. Install Adafruit GFX Library and Adafruit SSD1306.
2. Open each .ino from its own folder and select the same ESP32-WROOM DevKit
   board profile and its own COM port.
3. Upload OLEDIntro.ino to the OLED board and MotorController.ino to the motor
   board. Upload each board separately; disconnect/reconnect USB as needed to
   select the right COM port.
4. Power both boards together. The OLED starts the song board at frame 0.

The animation uses 150 x 1024 bytes of frame data, stored in program flash.
