module Hunker.Repository.View.Toolbar exposing (Config, Tab(..), view)

import Html exposing (Html, button, div, span, strong, text)
import Html.Attributes exposing (attribute, class, classList, type_)
import Html.Events exposing (onClick)


type Tab
    = FilesTab
    | PullsTab
    | CommitsTab


type alias Config msg =
    { repository : String
    , activeTab : Tab
    , selectedTab : Tab -> msg
    }


view : Config msg -> List (Html msg)
view config =
    [ div [ class "repository-identity" ]
        [ span [] [ text "Local repository" ]
        , strong [] [ text config.repository ]
        ]
    , div [ class "segmented repository-view-tabs", attribute "role" "group", attribute "aria-label" "Repository view" ]
        [ tabButton config "Files" FilesTab
        , tabButton config "Pull requests" PullsTab
        , tabButton config "Commits" CommitsTab
        ]
    ]


tabButton : Config msg -> String -> Tab -> Html msg
tabButton config label tab =
    button
        [ type_ "button"
        , classList [ ( "segmented-button", True ), ( "is-active", tab == config.activeTab ) ]
        , onClick (config.selectedTab tab)
        ]
        [ text label ]
