// THE LIFE A BOARD HAS, BY THE PANELS ON IT (outcome.c lifeOf), in frames: made by material.c from 96 games of 4 runs (39137780746, 39137784697, 39137788159, 39137792044),
// 20 lost -- never by hand. A row's worth of panels a bin, its frames over its losses (a loss not yet seen counted as one), drawn
// straight between the bins' middles:
//    0- 5      1144 frames    0 lost
//    6-11     12614 frames    2 lost
//   12-17     53731 frames    0 lost
//   18-23    151409 frames    0 lost
//   24-29    259068 frames    0 lost
//   30-35    315232 frames    0 lost
//   36-41    291619 frames    0 lost
//   42-47    267620 frames    1 lost
//   48-53    252955 frames    1 lost
//   54-59    175388 frames    6 lost
//   60-65     73612 frames    6 lost
//   66-71      5736 frames    4 lost
//   72-77         0 frames    0 lost
#define LIFEMAX 72
static const int32_t LIFE[LIFEMAX + 1] = {
  1144, 1144, 1144, 1574, 2435, 3295, 4156, 5016, 5877, 10259, 18163, 26067,
  33971, 41875, 49779, 61871, 78151, 94430, 110710, 126990, 143269, 160381, 178324, 196267,
  214210, 232153, 250096, 263748, 273109, 282470, 291830, 301191, 310552, 313264, 309329, 305393,
  301458, 297522, 293587, 289619, 285619, 281619, 277620, 273620, 269620, 266398, 263954, 261510,
  259065, 256621, 254177, 234311, 197024, 159737, 122450, 85162, 47875, 27818, 24991, 22164,
  19336, 16509, 13682, 11366, 9560, 7754, 5948, 4143, 2337, 1434, 1434, 1434,
  1434
};
