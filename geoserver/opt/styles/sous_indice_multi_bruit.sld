<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" version="1.0.0" xmlns:gml="http://www.opengis.net/gml" xmlns:sld="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">
  <UserLayer>
    <sld:LayerFeatureConstraints>
      <sld:FeatureTypeConstraint/>
    </sld:LayerFeatureConstraints>
    <sld:UserStyle>
      <sld:Name>sous_indice_multibruit_aura</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:RasterSymbolizer>
            <sld:ChannelSelection>
              <sld:GrayChannel>
                <sld:SourceChannelName>1</sld:SourceChannelName>
              </sld:GrayChannel>
            </sld:ChannelSelection>
            <sld:ColorMap type="intervals">
              <sld:ColorMapEntry color="#00ff55" label="Zone préservée" quantity="1.857144571428571"/>
              <sld:ColorMapEntry color="#b9ff73" label="Zone peu altérée" quantity="2.7142840000000001"/>
              <sld:ColorMapEntry color="#ffff00" label="Zone moyennement altérée" quantity="3.5714285714285712"/>
              <sld:ColorMapEntry color="#ffaa00" label="Zone altérée" quantity="4.0857142857142854"/>
              <sld:ColorMapEntry color="#ff0000" label="Zone dégradée" quantity="5.1142857142857139"/>
              <sld:ColorMapEntry color="#d500ff" label="Zone très dégradée" quantity="6.1428571428571423"/>
              <sld:ColorMapEntry color="#960064" label="Zone hautement dégradée" quantity="inf"/>
            </sld:ColorMap>
          </sld:RasterSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </UserLayer>
</StyledLayerDescriptor>
